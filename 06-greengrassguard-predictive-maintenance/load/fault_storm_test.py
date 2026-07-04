"""Load test for GreengrassGuard's stated scalability mechanism: SQS batch-size-10 consumer
with partial-failure handling absorbing fault-storm bursts.

Simulates ~20 assets faulting simultaneously (every asset emits a vibe_fault every ~150ms,
mimicking a real fault storm where many rotating assets cross their vibration threshold in
the same window) for ~60s, invoking the real deployed guard-diagnosis-relay-fn Lambda over
the network against floci — the same handler code API Gateway's Lambda proxy integration
would call (see load/results.md for why the HTTP API route itself can't be hit on floci).

Measures SQS ApproximateNumberOfMessages (queue backlog) sampled every second across the
burst: floci does not expose ApproximateAgeOfOldestMessage, so backlog depth staying bounded
(not growing unbounded) is the before/after proxy for "the batch consumer keeps up".
"""
import json
import os
import threading
import time
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timezone

import boto3

ENDPOINT = os.environ.get("AWS_ENDPOINT_URL", "http://localhost:4566")
REGION = os.environ.get("AWS_REGION", "eu-west-1")
QUEUE_URL = "http://localhost:4566/000000000000/guard-fault-intake-queue"
RELAY_FN_NAME = "guard-diagnosis-relay-fn"
TABLE_NAME = "GuardDiagnosisEvents"

NUM_ASSETS = 20
BURST_SECONDS = 60
DISPATCH_INTERVAL_S = 0.15  # each asset's fog node fires a fault roughly every 150ms during the storm

session_kwargs = dict(
    region_name=REGION,
    aws_access_key_id="test",
    aws_secret_access_key="test",
)

lambda_client = boto3.client("lambda", endpoint_url=ENDPOINT, **session_kwargs)
sqs = boto3.client("sqs", endpoint_url=ENDPOINT, **session_kwargs)
dynamodb = boto3.resource("dynamodb", endpoint_url=ENDPOINT, **session_kwargs)


def make_vibe_fault(asset_id: str, seq: int) -> dict:
    return {
        "type": "vibe_fault",
        "asset_id": asset_id,
        "metric": "vibe-axial",
        "fault_bands": [
            {"band": "mid", "energy": 12.3 + seq, "anomaly_score": 4.1},
        ],
        "timestamp": datetime.now(timezone.utc).isoformat(),
        "severity": "medium",
        "acoustic_corroborated": False,
    }


def invoke_relay(event: dict) -> tuple[bool, float]:
    """Direct lambda:Invoke of the deployed relay fn, same payload shape API Gateway's
    Lambda proxy integration sends (floci's HTTP API v2 data plane isn't invokable locally)."""
    payload = {"body": json.dumps(event)}
    start = time.monotonic()
    try:
        resp = lambda_client.invoke(
            FunctionName=RELAY_FN_NAME,
            InvocationType="RequestResponse",
            Payload=json.dumps(payload).encode(),
        )
        elapsed = time.monotonic() - start
        body = json.loads(resp["Payload"].read())
        ok = body.get("statusCode") == 202
        return ok, elapsed
    except Exception:
        return False, time.monotonic() - start


def read_stored_counter() -> int:
    table = dynamodb.Table(TABLE_NAME)
    item = table.get_item(
        Key={"asset_id": "__ops_counters__", "event_type_timestamp": "counters"}
    ).get("Item", {})
    return int(item.get("messages_stored", 0))


def sample_queue_depth(samples: list, stop_event: threading.Event):
    while not stop_event.is_set():
        t = time.monotonic()
        try:
            attrs = sqs.get_queue_attributes(
                QueueUrl=QUEUE_URL,
                AttributeNames=["ApproximateNumberOfMessages", "ApproximateNumberOfMessagesNotVisible"],
            )["Attributes"]
            samples.append({
                "t": t,
                "visible": int(attrs.get("ApproximateNumberOfMessages", 0)),
                "in_flight": int(attrs.get("ApproximateNumberOfMessagesNotVisible", 0)),
            })
        except Exception as exc:
            samples.append({"t": t, "error": str(exc)})
        time.sleep(1.0)


def run_burst() -> dict:
    stored_before = read_stored_counter()
    depth_before = sqs.get_queue_attributes(
        QueueUrl=QUEUE_URL, AttributeNames=["ApproximateNumberOfMessages"]
    )["Attributes"]

    samples: list = []
    stop_event = threading.Event()
    sampler = threading.Thread(target=sample_queue_depth, args=(samples, stop_event), daemon=True)
    sampler.start()

    latencies = []
    successes = 0
    failures = 0
    sent = 0

    burst_start = time.monotonic()
    with ThreadPoolExecutor(max_workers=NUM_ASSETS) as pool:
        seq = 0
        while time.monotonic() - burst_start < BURST_SECONDS:
            round_start = time.monotonic()
            events = [make_vibe_fault(f"asset-{i:02d}", seq) for i in range(1, NUM_ASSETS + 1)]
            futures = [pool.submit(invoke_relay, e) for e in events]
            for f in futures:
                ok, elapsed = f.result()
                sent += 1
                latencies.append(elapsed)
                if ok:
                    successes += 1
                else:
                    failures += 1
            seq += 1
            elapsed_round = time.monotonic() - round_start
            sleep_for = DISPATCH_INTERVAL_S - elapsed_round
            if sleep_for > 0:
                time.sleep(sleep_for)

    burst_duration = time.monotonic() - burst_start

    # let the batch consumer catch up, then take a final drain reading
    time.sleep(5)
    stop_event.set()
    sampler.join(timeout=2)

    stored_after = read_stored_counter()
    depth_after = sqs.get_queue_attributes(
        QueueUrl=QUEUE_URL, AttributeNames=["ApproximateNumberOfMessages"]
    )["Attributes"]

    latencies.sort()
    n = len(latencies)
    p50 = latencies[n // 2] if n else 0
    p95 = latencies[int(n * 0.95)] if n else 0
    p99 = latencies[int(n * 0.99)] if n else 0

    return {
        "num_assets": NUM_ASSETS,
        "burst_duration_s": round(burst_duration, 2),
        "requests_sent": sent,
        "successes": successes,
        "failures": failures,
        "effective_rate_req_s": round(sent / burst_duration, 2),
        "latency_p50_ms": round(p50 * 1000, 1),
        "latency_p95_ms": round(p95 * 1000, 1),
        "latency_p99_ms": round(p99 * 1000, 1),
        "queue_depth_before": depth_before,
        "queue_depth_after": depth_after,
        "queue_depth_samples": samples,
        "max_visible_depth_during_burst": max((s.get("visible", 0) for s in samples), default=0),
        "max_in_flight_during_burst": max((s.get("in_flight", 0) for s in samples), default=0),
        "messages_stored_before": stored_before,
        "messages_stored_after": stored_after,
        "messages_stored_delta": stored_after - stored_before,
    }


if __name__ == "__main__":
    print(f"starting fault-storm burst: {NUM_ASSETS} assets, {BURST_SECONDS}s, "
          f"~{1/DISPATCH_INTERVAL_S:.1f} rounds/s")
    result = run_burst()
    print(json.dumps(result, indent=2, default=str))

    with open(os.path.join(os.path.dirname(__file__), "last_run_raw.json"), "w") as f:
        json.dump(result, f, indent=2, default=str)
