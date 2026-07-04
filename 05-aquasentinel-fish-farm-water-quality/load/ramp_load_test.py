"""Load-test driver for the readings-queue vs alerts-queue split (the scalability mechanism
under test). Ramps concurrent simulated ponds from ~5 to ~40, each posting both a routine
reading and a toxic alert per round, and times each path through the real deployed relay
Lambdas -> real SQS queues. Invokes the actual deployed Lambdas via boto3 (the same entry
point API Gateway would call) since floci does not implement execute-api invoke routing for
HTTP APIs -- see load/results.md for that finding. Run against floci with the stack already
deployed (see README's "Local development" section).
"""
import json
import statistics
import time
from concurrent.futures import ThreadPoolExecutor, as_completed
from datetime import datetime, timezone

import boto3

ENDPOINT_URL = "http://localhost:4566"
REGION = "eu-west-1"
RAMP_LEVELS = [5, 10, 20, 40]
ROUNDS_PER_LEVEL = 3  # each simulated pond posts this many reading+alert pairs per level

session = boto3.session.Session(
    aws_access_key_id="test",
    aws_secret_access_key="test",
    region_name=REGION,
)
lam = session.client("lambda", endpoint_url=ENDPOINT_URL)
sqs = session.client("sqs", endpoint_url=ENDPOINT_URL)


def _now_iso() -> str:
    return datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%S.%f")[:-3] + "Z"


def _invoke(function_name: str, route: str, body: dict) -> float:
    """Invokes the real deployed relay Lambda with an API-Gateway-v2-shaped event; returns latency in ms."""
    event = {
        "version": "2.0",
        "routeKey": route,
        "rawPath": route.split(" ")[1],
        "body": json.dumps(body),
        "isBase64Encoded": False,
    }
    t0 = time.perf_counter()
    resp = lam.invoke(FunctionName=function_name, Payload=json.dumps(event).encode())
    latency_ms = (time.perf_counter() - t0) * 1000
    payload = json.loads(resp["Payload"].read())
    if payload.get("statusCode") != 202:
        raise RuntimeError(f"{function_name} returned {payload}")
    return latency_ms


def _post_reading(pond_id: str) -> float:
    body = {
        "type": "dissolved_oxygen",
        "pond_id": pond_id,
        "value": 6.5,
        "timestamp": _now_iso(),
    }
    return _invoke("aquasentinel-relay-readings-fn", "POST /readings", body)


def _post_alert(pond_id: str) -> float:
    body = {
        "type": "toxicity",
        "severity": "toxic",
        "pond_id": pond_id,
        "uia_mg_per_l": 0.85,  # field name must match fog_toxicity.py's real event schema
        "timestamp": _now_iso(),
    }
    return _invoke("aquasentinel-relay-alerts-fn", "POST /alerts", body)


def _pond_worker(pond_index: int) -> dict:
    pond_id = f"pond-load-{pond_index:03d}"
    reading_latencies, alert_latencies = [], []
    for _ in range(ROUNDS_PER_LEVEL):
        reading_latencies.append(_post_reading(pond_id))
        alert_latencies.append(_post_alert(pond_id))
    return {"reading_latencies": reading_latencies, "alert_latencies": alert_latencies}


def _queue_depth(queue_name: str) -> dict:
    url = sqs.get_queue_url(QueueName=queue_name)["QueueUrl"]
    attrs = sqs.get_queue_attributes(
        QueueUrl=url,
        AttributeNames=["ApproximateNumberOfMessages", "ApproximateNumberOfMessagesNotVisible"],
    )["Attributes"]
    return {"queue": queue_name, **attrs}


def _percentile(values: list, pct: float) -> float:
    if not values:
        return 0.0
    ordered = sorted(values)
    idx = min(int(len(ordered) * pct), len(ordered) - 1)
    return ordered[idx]


def run_level(concurrent_ponds: int) -> dict:
    print(f"\n=== ramping to {concurrent_ponds} concurrent ponds ===")
    start = time.perf_counter()
    all_readings, all_alerts = [], []
    with ThreadPoolExecutor(max_workers=concurrent_ponds) as pool:
        futures = [pool.submit(_pond_worker, i) for i in range(concurrent_ponds)]
        for f in as_completed(futures):
            result = f.result()
            all_readings.extend(result["reading_latencies"])
            all_alerts.extend(result["alert_latencies"])
    wall_s = time.perf_counter() - start

    # queue depth read immediately after the burst, while ingest Lambdas are still draining
    readings_depth = _queue_depth("aquasentinel-readings-queue")
    alerts_depth = _queue_depth("aquasentinel-alerts-queue")

    summary = {
        "concurrent_ponds": concurrent_ponds,
        "total_requests": len(all_readings) + len(all_alerts),
        "wall_time_s": round(wall_s, 3),
        "readings_path": {
            "count": len(all_readings),
            "mean_ms": round(statistics.mean(all_readings), 1),
            "p50_ms": round(_percentile(all_readings, 0.50), 1),
            "p95_ms": round(_percentile(all_readings, 0.95), 1),
            "max_ms": round(max(all_readings), 1),
        },
        "alerts_path": {
            "count": len(all_alerts),
            "mean_ms": round(statistics.mean(all_alerts), 1),
            "p50_ms": round(_percentile(all_alerts, 0.50), 1),
            "p95_ms": round(_percentile(all_alerts, 0.95), 1),
            "max_ms": round(max(all_alerts), 1),
        },
        "readings_queue_depth_snapshot": readings_depth,
        "alerts_queue_depth_snapshot": alerts_depth,
    }
    print(json.dumps(summary, indent=2))
    return summary


def main():
    results = [run_level(n) for n in RAMP_LEVELS]
    out_path = "load/raw_results.json"
    with open(out_path, "w") as fh:
        json.dump(results, fh, indent=2)
    print(f"\nraw results written to {out_path}")


if __name__ == "__main__":
    main()
