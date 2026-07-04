"""Load driver for HarborPulse's stated scalability mechanism: reserved concurrency=20 on
harborpulse-ingest-telemetry-fn. Simulates a ~20-vessel fleet posting telemetry events by
invoking relay_telemetry directly (the same handler API Gateway's POST /telemetry route
calls) with the same event shape API Gateway would pass it -- {"body": <raw json string>}.
That relay puts the message on harborpulse-telemetry-queue, which is what actually triggers
ingest_telemetry under its reserved concurrency cap.

Two stages, ~1 minute each (scaled down 10x from the assignment's ~10min guidance):
  NORMAL stage: 20 vessels, one telemetry event every ~2s per vessel  (~10 events/sec fleet-wide)
  RAMPED stage: same 20 vessels, one event every ~1s per vessel      (~20 events/sec fleet-wide, ~2x)

At the end of each stage, polls SQS GetQueueAttributes for queue depth (visible + in-flight)
and Lambda GetFunctionConcurrency / GetFunction for the reserved-concurrency ceiling, and
records per-request latency for the relay invocation itself.
"""
import json
import os
import statistics
import threading
import time
from concurrent.futures import ThreadPoolExecutor, as_completed

import boto3
from botocore.config import Config

os.environ.setdefault("AWS_ENDPOINT_URL", "http://localhost:4566")
os.environ.setdefault("AWS_ACCESS_KEY_ID", "test")
os.environ.setdefault("AWS_SECRET_ACCESS_KEY", "test")
os.environ.setdefault("AWS_REGION", "eu-west-1")
os.environ.setdefault("AWS_DEFAULT_REGION", "eu-west-1")

FUNCTION_NAME = "harborpulse-relay-telemetry-fn"
INGEST_FUNCTION_NAME = "harborpulse-ingest-telemetry-fn"
QUEUE_NAME = "harborpulse-telemetry-queue"
FLEET_SIZE = 20
METRIC_TYPES = [
    "engine-rpm", "engine-coolant-temp", "engine-oil-pressure", "engine-fuel-flow",
    "nav-gps", "nav-attitude", "weather-wind-speed", "nav-heading",
]

# floci is a single shared container also serving other projects' concurrent test runs, so a
# generous retry/backoff config and a wide connection pool absorb its transient connection resets.
_boto_config = Config(
    retries={"max_attempts": 6, "mode": "adaptive"},
    connect_timeout=5,
    read_timeout=15,
    max_pool_connections=50,
)
lam = boto3.client("lambda", config=_boto_config)
sqs = boto3.client("sqs", config=_boto_config)
queue_url = sqs.get_queue_url(QueueName=QUEUE_NAME)["QueueUrl"]

_counter = 0
_counter_lock = threading.Lock()


def _next_id():
    global _counter
    with _counter_lock:
        _counter += 1
        return _counter


def post_one_event(vessel_id: str) -> float:
    """Invokes relay_telemetry with one synthetic event, mirroring an API Gateway POST body.
    Returns wall-clock latency in seconds."""
    n = _next_id()
    metric = METRIC_TYPES[n % len(METRIC_TYPES)]
    body = json.dumps({
        "type": "engine_health_event",
        "vesselId": vessel_id,
        "metric": metric,
        "value": 42.0 + (n % 7),
        "timestamp": time.strftime("%Y-%m-%dT%H:%M:%S.000Z", time.gmtime()),
    })
    start = time.perf_counter()
    resp = lam.invoke(
        FunctionName=FUNCTION_NAME,
        InvocationType="RequestResponse",
        Payload=json.dumps({"body": body}).encode(),
    )
    payload = json.loads(resp["Payload"].read())
    elapsed = time.perf_counter() - start
    if resp.get("FunctionError") or payload.get("statusCode") != 202:
        raise RuntimeError(f"relay failed: {payload}")
    return elapsed


def _with_retries(fn, attempts=5, base_delay=1.5):
    """floci occasionally resets connections under concurrent load from sibling projects'
    test runs sharing the container; a plain snapshot call is cheap to retry."""
    last_exc = None
    for attempt in range(attempts):
        try:
            return fn()
        except Exception as exc:  # noqa: BLE001 -- broad on purpose, this is a local-emulator flakiness shim
            last_exc = exc
            time.sleep(base_delay * (attempt + 1))
    raise last_exc


def queue_snapshot() -> dict:
    attrs = sqs.get_queue_attributes(
        QueueUrl=queue_url,
        AttributeNames=[
            "ApproximateNumberOfMessages",
            "ApproximateNumberOfMessagesNotVisible",
            "ApproximateNumberOfMessagesDelayed",
        ],
    )["Attributes"]
    return {
        "visible": int(attrs["ApproximateNumberOfMessages"]),
        "in_flight": int(attrs["ApproximateNumberOfMessagesNotVisible"]),
        "delayed": int(attrs["ApproximateNumberOfMessagesDelayed"]),
    }


def concurrency_snapshot() -> dict:
    reserved = lam.get_function_concurrency(FunctionName=INGEST_FUNCTION_NAME)
    cfg = lam.get_function_configuration(FunctionName=INGEST_FUNCTION_NAME)
    return {
        "reserved_concurrent_executions": reserved.get("ReservedConcurrentExecutions"),
        "state": cfg.get("State"),
        "last_update_status": cfg.get("LastUpdateStatus"),
    }


def run_stage(stage_name: str, dispatch_interval_s: float, duration_s: float) -> dict:
    """Runs FLEET_SIZE vessels each posting one event every dispatch_interval_s, for
    duration_s seconds total, using a thread pool so requests genuinely overlap."""
    print(f"\n=== stage: {stage_name} (interval={dispatch_interval_s}s/vessel, "
          f"duration={duration_s}s, fleet={FLEET_SIZE}) ===")

    stop_at = time.monotonic() + duration_s
    latencies = []
    errors = 0
    submitted = 0
    lock = threading.Lock()

    def vessel_loop(vessel_index: int):
        nonlocal errors, submitted
        vessel_id = f"vessel-load-{vessel_index:02d}"
        while time.monotonic() < stop_at:
            tick_start = time.monotonic()
            try:
                latency = post_one_event(vessel_id)
                with lock:
                    latencies.append(latency)
                    submitted += 1
            except Exception as exc:  # noqa: BLE001 -- load driver must keep other vessels going
                with lock:
                    errors += 1
                print(f"  [{vessel_id}] error: {exc}")
            elapsed = time.monotonic() - tick_start
            time.sleep(max(0.0, dispatch_interval_s - elapsed))

    stage_wall_start = time.monotonic()
    with ThreadPoolExecutor(max_workers=FLEET_SIZE) as pool:
        futures = [pool.submit(vessel_loop, i) for i in range(FLEET_SIZE)]
        for f in as_completed(futures):
            f.result()
    stage_wall_elapsed = time.monotonic() - stage_wall_start

    # give SQS/Lambda a moment to settle so the queue-depth snapshot reflects this stage's load
    time.sleep(2)
    q = _with_retries(queue_snapshot)
    conc = _with_retries(concurrency_snapshot)

    result = {
        "stage": stage_name,
        "target_interval_s_per_vessel": dispatch_interval_s,
        "target_fleet_rate_events_per_sec": round(FLEET_SIZE / dispatch_interval_s, 2),
        "wall_elapsed_s": round(stage_wall_elapsed, 2),
        "events_submitted": submitted,
        "errors": errors,
        "achieved_rate_events_per_sec": round(submitted / stage_wall_elapsed, 2),
        "latency_ms": {
            "min": round(min(latencies) * 1000, 2) if latencies else None,
            "p50": round(statistics.median(latencies) * 1000, 2) if latencies else None,
            "p95": round(statistics.quantiles(latencies, n=20)[18] * 1000, 2) if len(latencies) >= 20 else None,
            "max": round(max(latencies) * 1000, 2) if latencies else None,
        },
        "queue_after_stage": q,
        "ingest_fn_concurrency_config": conc,
    }
    print(json.dumps(result, indent=2))
    return result


def main():
    print(f"floci endpoint: {os.environ['AWS_ENDPOINT_URL']}")
    print(f"target function: {FUNCTION_NAME} -> queue: {queue_url}")
    print(f"ingest function under test: {INGEST_FUNCTION_NAME}")

    baseline_q = queue_snapshot()
    baseline_conc = concurrency_snapshot()
    print(f"\nbaseline queue: {baseline_q}")
    print(f"baseline ingest fn concurrency config: {baseline_conc}")

    # ~2 minutes total, scaled down from the assignment's ~10min guidance, split across
    # a normal-rate stage and a ~2x ramped-rate stage.
    normal = run_stage("NORMAL (baseline dispatch rate)", dispatch_interval_s=2.0, duration_s=60)
    ramped = run_stage("RAMPED (~2x dispatch rate)", dispatch_interval_s=1.0, duration_s=60)

    summary = {
        "run_started_utc": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime(time.time() - 122)),
        "run_finished_utc": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
        "fleet_size": FLEET_SIZE,
        "baseline_queue": baseline_q,
        "baseline_ingest_fn_concurrency_config": baseline_conc,
        "normal_stage": normal,
        "ramped_stage": ramped,
    }

    out_path = os.path.join(os.path.dirname(__file__), "last_run_raw.json")
    with open(out_path, "w") as f:
        json.dump(summary, f, indent=2)
    print(f"\nraw results written to {out_path}")


if __name__ == "__main__":
    main()
