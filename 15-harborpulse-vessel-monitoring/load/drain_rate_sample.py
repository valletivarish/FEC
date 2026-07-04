"""Standalone drain-rate sampler for HarborPulse's stated scalability mechanism: reserved
concurrency=20 on harborpulse-ingest-telemetry-fn. Unlike fleet_ramp_load_test.py (which only
snapshots the queue once at the end of each stage), this script pushes its own burst onto the
real queue and then genuinely polls sqs:GetQueueAttributes every 5s for ~55s, so the drain curve
in results.md is backed by a script that actually produces it.

Burst mechanism: invokes harborpulse-relay-telemetry-fn (same handler API Gateway's POST
/telemetry route calls) as fast as a thread pool allows, for a fixed number of events, which
puts real messages on harborpulse-telemetry-queue -- the same path fleet_ramp_load_test.py uses.
"""
import json
import os
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
BURST_EVENTS = 400
BURST_WORKERS = 20
SAMPLE_INTERVAL_S = 5.0
SAMPLE_DURATION_S = 55.0
METRIC_TYPES = [
    "engine-rpm", "engine-coolant-temp", "engine-oil-pressure", "engine-fuel-flow",
    "nav-gps", "nav-attitude", "weather-wind-speed", "nav-heading",
]

# same rationale as fleet_ramp_load_test.py: floci is a single shared container, so retries
# absorb transient connection resets from sibling projects' concurrent activity.
_boto_config = Config(
    retries={"max_attempts": 6, "mode": "adaptive"},
    connect_timeout=5,
    read_timeout=15,
    max_pool_connections=50,
)
lam = boto3.client("lambda", config=_boto_config)
sqs = boto3.client("sqs", config=_boto_config)
queue_url = sqs.get_queue_url(QueueName=QUEUE_NAME)["QueueUrl"]


def post_one_event(n: int) -> None:
    metric = METRIC_TYPES[n % len(METRIC_TYPES)]
    body = json.dumps({
        "type": "engine_health_event",
        "vesselId": f"vessel-drain-{n % BURST_WORKERS:02d}",
        "metric": metric,
        "value": 42.0 + (n % 7),
        "timestamp": time.strftime("%Y-%m-%dT%H:%M:%S.000Z", time.gmtime()),
    })
    resp = lam.invoke(
        FunctionName=FUNCTION_NAME,
        InvocationType="RequestResponse",
        Payload=json.dumps({"body": body}).encode(),
    )
    payload = json.loads(resp["Payload"].read())
    if resp.get("FunctionError") or payload.get("statusCode") != 202:
        raise RuntimeError(f"relay failed: {payload}")


def queue_snapshot() -> dict:
    attrs = sqs.get_queue_attributes(
        QueueUrl=queue_url,
        AttributeNames=["ApproximateNumberOfMessages", "ApproximateNumberOfMessagesNotVisible"],
    )["Attributes"]
    return {
        "visible": int(attrs["ApproximateNumberOfMessages"]),
        "in_flight": int(attrs["ApproximateNumberOfMessagesNotVisible"]),
    }


def push_burst(n_events: int) -> tuple[int, int]:
    """Fires n_events relay invocations from a thread pool as fast as possible to build a
    real backlog behind the ingest function's reserved-concurrency=20 ceiling. Returns
    (submitted, errors)."""
    submitted = 0
    errors = 0
    with ThreadPoolExecutor(max_workers=BURST_WORKERS) as pool:
        futures = [pool.submit(post_one_event, i) for i in range(n_events)]
        for f in as_completed(futures):
            try:
                f.result()
                submitted += 1
            except Exception as exc:  # noqa: BLE001 -- burst driver must keep going on isolated failures
                errors += 1
                print(f"  burst event error: {exc}")
    return submitted, errors


def main():
    print(f"floci endpoint: {os.environ['AWS_ENDPOINT_URL']}")
    print(f"queue: {queue_url}")
    conc = lam.get_function_concurrency(FunctionName=INGEST_FUNCTION_NAME)
    print(f"ingest fn reserved concurrency: {conc.get('ReservedConcurrentExecutions')}")

    baseline = queue_snapshot()
    print(f"baseline queue: {baseline}")

    print(f"\npushing burst of {BURST_EVENTS} events via {FUNCTION_NAME} "
          f"({BURST_WORKERS} concurrent workers)...")
    burst_start = time.monotonic()
    submitted, errors = push_burst(BURST_EVENTS)
    burst_elapsed = time.monotonic() - burst_start
    print(f"burst done: submitted={submitted} errors={errors} wall={burst_elapsed:.2f}s")

    after_burst = queue_snapshot()
    print(f"queue immediately after burst: {after_burst}")

    print(f"\nsampling queue depth every {SAMPLE_INTERVAL_S}s for {SAMPLE_DURATION_S}s...")
    samples = []
    sample_start = time.monotonic()
    run_started_utc = time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())
    next_sample_at = sample_start
    while True:
        t_s = time.monotonic() - sample_start
        if t_s > SAMPLE_DURATION_S:
            break
        snap = queue_snapshot()
        sample = {
            "t_s": round(t_s, 1),
            "wall_clock_utc": time.strftime("%Y-%m-%dT%H:%M:%S.000Z", time.gmtime()),
            "visible": snap["visible"],
            "in_flight": snap["in_flight"],
        }
        samples.append(sample)
        print(f"  t={sample['t_s']:>5}s  visible={sample['visible']:>4}  "
              f"in_flight={sample['in_flight']:>3}  ({sample['wall_clock_utc']})")
        next_sample_at += SAMPLE_INTERVAL_S
        sleep_for = next_sample_at - time.monotonic()
        if sleep_for > 0:
            time.sleep(sleep_for)
    run_finished_utc = time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())

    out_path = os.path.join(os.path.dirname(__file__), "drain_samples.json")
    with open(out_path, "w") as f:
        json.dump(samples, f, indent=2)
    print(f"\n{len(samples)} samples written to {out_path}")

    meta_path = os.path.join(os.path.dirname(__file__), "drain_samples_meta.json")
    with open(meta_path, "w") as f:
        json.dump({
            "run_started_utc": run_started_utc,
            "run_finished_utc": run_finished_utc,
            "burst_events_target": BURST_EVENTS,
            "burst_events_submitted": submitted,
            "burst_errors": errors,
            "burst_wall_elapsed_s": round(burst_elapsed, 2),
            "queue_baseline_before_burst": baseline,
            "queue_immediately_after_burst": after_burst,
            "ingest_fn_reserved_concurrency": conc.get("ReservedConcurrentExecutions"),
        }, f, indent=2)
    print(f"run metadata written to {meta_path}")


if __name__ == "__main__":
    main()
