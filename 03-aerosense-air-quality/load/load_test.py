"""Ramp load test for the advisory-ingest path: advisory_intake_fn -> SQS -> advisory_ingest_fn.

Invokes the deployed intake Lambda directly with the same API-Gateway-shaped event the HTTP API
proxies, since floci's community edition accepts apigatewayv2 control-plane calls (create/deploy)
but does not implement HTTP API edge/data-plane routing (confirmed: create_deployment succeeds,
get_stages returns empty, and execute-api paths 404/wrong-service). Invoking the Lambda directly
exercises the exact same handler code API Gateway would call, so the SQS + batch-consumer
scaling mechanism under test is unaffected.

Usage:
    AWS_ENDPOINT_URL=http://localhost:4566 AWS_ACCESS_KEY_ID=test AWS_SECRET_ACCESS_KEY=test \
      AWS_REGION=eu-west-1 python3 load/load_test.py
"""
import json
import os
import statistics
import time
from concurrent.futures import ThreadPoolExecutor, as_completed

import boto3

ENDPOINT = os.environ.get("AWS_ENDPOINT_URL", "http://localhost:4566")
REGION = os.environ.get("AWS_REGION", "eu-west-1")
FUNCTION_NAME = "aerosense-advisory-intake-fn"
QUEUE_NAME = "aerosense-advisory-queue"
DLQ_NAME = "aerosense-advisory-dlq"

# (target requests/sec, duration seconds) — ramp from ~10 to ~80 req/s.
STAGES = [
    (10, 5),
    (20, 5),
    (40, 5),
    (80, 5),
]

session_kwargs = dict(
    endpoint_url=ENDPOINT,
    region_name=REGION,
    aws_access_key_id=os.environ.get("AWS_ACCESS_KEY_ID", "test"),
    aws_secret_access_key=os.environ.get("AWS_SECRET_ACCESS_KEY", "test"),
)


def make_event(seq: int) -> dict:
    # microsecond-resolution timestamp keeps (zone_id, timestamp#sensor) unique per request so
    # DynamoDB put_item never overwrites a prior load-test item under high concurrency.
    ts = time.strftime("%Y-%m-%dT%H:%M:%S", time.gmtime()) + f".{seq:06d}Z"
    body = {
        "zone_id": f"zone-load-{seq % 10}",
        "sensor": "co2",
        "advisory_type": "band_change",
        "band": "moderate",
        "value": 800 + (seq % 200),
        "timestamp": ts,
        "details": {"load_test_seq": seq},
    }
    return {"body": json.dumps(body)}


def invoke_one(lam, seq: int) -> tuple[float, int]:
    t0 = time.perf_counter()
    resp = lam.invoke(FunctionName=FUNCTION_NAME, Payload=json.dumps(make_event(seq)).encode())
    latency_ms = (time.perf_counter() - t0) * 1000
    payload = json.loads(resp["Payload"].read())
    status = payload.get("statusCode", 0)
    return latency_ms, status


def queue_snapshot(sqs, queue_url: str) -> dict:
    attrs = sqs.get_queue_attributes(
        QueueUrl=queue_url,
        AttributeNames=["ApproximateNumberOfMessages", "ApproximateNumberOfMessagesNotVisible"],
    )["Attributes"]
    return {
        "visible": int(attrs.get("ApproximateNumberOfMessages", 0)),
        "in_flight": int(attrs.get("ApproximateNumberOfMessagesNotVisible", 0)),
    }


def run_stage(lam, target_rps: int, duration_s: int, seq_start: int) -> dict:
    """Fire target_rps invocations per second, sequentially per second, in a thread pool."""
    latencies = []
    errors = 0
    seq = seq_start
    stage_t0 = time.perf_counter()

    with ThreadPoolExecutor(max_workers=max(target_rps, 10)) as pool:
        for second in range(duration_s):
            second_t0 = time.perf_counter()
            futures = [pool.submit(invoke_one, lam, seq + i) for i in range(target_rps)]
            seq += target_rps
            for fut in as_completed(futures):
                try:
                    latency_ms, status = fut.result()
                    latencies.append(latency_ms)
                    if status != 202:
                        errors += 1
                except Exception:
                    errors += 1
            elapsed = time.perf_counter() - second_t0
            if elapsed < 1.0:
                time.sleep(1.0 - elapsed)

    stage_elapsed = time.perf_counter() - stage_t0
    latencies.sort()
    n = len(latencies)
    p50 = latencies[int(n * 0.50)] if n else 0.0
    p95 = latencies[min(int(n * 0.95), n - 1)] if n else 0.0
    p99 = latencies[min(int(n * 0.99), n - 1)] if n else 0.0
    return {
        "target_rps": target_rps,
        "duration_s": duration_s,
        "requests_sent": n + errors,
        "errors": errors,
        "actual_rps": round((n + errors) / stage_elapsed, 1),
        "p50_ms": round(p50, 2),
        "p95_ms": round(p95, 2),
        "p99_ms": round(p99, 2),
        "mean_ms": round(statistics.mean(latencies), 2) if latencies else 0.0,
        "max_ms": round(max(latencies), 2) if latencies else 0.0,
        "next_seq": seq,
    }


def main():
    lam = boto3.client("lambda", **session_kwargs)
    sqs = boto3.client("sqs", **session_kwargs)
    queue_url = sqs.get_queue_url(QueueName=QUEUE_NAME)["QueueUrl"]
    dlq_url = sqs.get_queue_url(QueueName=DLQ_NAME)["QueueUrl"]

    print(f"run started: {time.strftime('%Y-%m-%dT%H:%M:%SZ', time.gmtime())}")
    print(f"endpoint: {ENDPOINT}  function: {FUNCTION_NAME}  queue: {QUEUE_NAME}")

    before_low = queue_snapshot(sqs, queue_url)
    print(f"\nqueue depth before run (t=0): {before_low}")

    seq = 0
    results = []
    for target_rps, duration_s in STAGES:
        pre = queue_snapshot(sqs, queue_url)
        result = run_stage(lam, target_rps, duration_s, seq)
        seq = result["next_seq"]
        # allow the batch consumer a moment to drain before the next snapshot
        time.sleep(1.0)
        post = queue_snapshot(sqs, queue_url)
        result["queue_depth_before"] = pre
        result["queue_depth_after_drain"] = post
        results.append(result)
        print(
            f"stage target={target_rps:>3} req/s actual={result['actual_rps']:>6} req/s "
            f"sent={result['requests_sent']:>4} errors={result['errors']} "
            f"p50={result['p50_ms']:>7}ms p95={result['p95_ms']:>7}ms p99={result['p99_ms']:>7}ms "
            f"max={result['max_ms']:>7}ms queue_after={post}"
        )

    dlq_depth = queue_snapshot(sqs, dlq_url)
    print(f"\nDLQ depth at end of run: {dlq_depth}")
    print(f"run finished: {time.strftime('%Y-%m-%dT%H:%M:%SZ', time.gmtime())}")

    out = {
        "endpoint": ENDPOINT,
        "function_name": FUNCTION_NAME,
        "queue_name": QUEUE_NAME,
        "started_at": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
        "stages": results,
        "dlq_depth_end": dlq_depth,
    }
    out_path = os.path.join(os.path.dirname(__file__), "last_run_raw.json")
    with open(out_path, "w") as f:
        json.dump(out, f, indent=2)
    print(f"\nraw results written to {out_path}")


if __name__ == "__main__":
    main()
