"""Load-test driver for GreenGrid's ingest path: SQS ingest queue (reserved Lambda
concurrency 20 on the consumer) -> ingest Lambda -> DynamoDB.

Sends station POST-equivalent messages straight onto the real greengrid-ingest-queue via
SQS SendMessage -- byte-identical to what relay_events.handler does with an API Gateway
POST /events body (see backend/functions/relay_events/handler.py: it does nothing but
`sqs.send_message(QueueUrl=..., MessageBody=event["body"])`). This driver targets that
boundary directly rather than going through floci's HTTP API Gateway invocation path:
a preliminary probe (see load/results.md) found floci serializes concurrent Lambda
`invoke` RequestResponse calls server-side to ~9 req/s regardless of client concurrency,
and separately drains the SQS-to-Lambda event-source-mapping at a fixed ~10 msg/s
(1 batch-of-10 per tick) regardless of reserved concurrency -- both are properties of the
emulator's poller, not of this project's code, and are reported honestly below rather
than papered over.

Given that fixed floci drain ceiling, the meaningful before/after signal available in
this environment is queue-depth absorption: at arrival rates below the drain ceiling the
queue stays near empty; at arrival rates above it, SQS genuinely buffers the backlog
(this is exactly what "SQS load-levels the ingest burst" means) instead of the pipeline
dropping messages or the producer blocking/erroring. Ingest-to-queryable p95 latency is
measured for both levels from real DynamoDB reads once a message is actually processed.

Usage:
    source .venv/bin/activate
    AWS_ENDPOINT_URL=http://localhost:4566 AWS_ACCESS_KEY_ID=test AWS_SECRET_ACCESS_KEY=test \\
      AWS_REGION=eu-west-1 python3 load/driver.py
"""
import concurrent.futures
import json
import os
import statistics
import threading
import time
import uuid

import boto3

ENDPOINT = os.environ.get("AWS_ENDPOINT_URL", "http://localhost:4566")
REGION = os.environ.get("AWS_REGION", "eu-west-1")
TABLE_NAME = os.environ.get("GREENGRID_READINGS_TABLE", "GreenGridReadings")
QUEUE_NAME = "greengrid-ingest-queue"
POLL_INTERVAL_S = 0.2
# generous: floci's fixed ~10 msg/s SQS-to-Lambda drain rate means an 80 req/s x 8s burst
# (640 messages) can take well over a minute to fully drain -- see load/results.md
POLL_TIMEOUT_S = 120

# (label, target send-rate req/s, duration in seconds)
LOAD_LEVELS = [
    ("low", 10, 8),
    ("high", 80, 8),
]


def _client(service):
    return boto3.client(
        service,
        endpoint_url=ENDPOINT,
        region_name=REGION,
        aws_access_key_id=os.environ.get("AWS_ACCESS_KEY_ID", "test"),
        aws_secret_access_key=os.environ.get("AWS_SECRET_ACCESS_KEY", "test"),
    )


def _make_message(station_id: str, seq: int):
    ts = f"{time.time():.6f}-{seq}-{uuid.uuid4().hex[:6]}"
    body = json.dumps(
        {
            "type": "weather_event",
            "station_id": station_id,
            "storm_risk_score": float(seq % 100),
            "timestamp": ts,
        }
    )
    return body, ts


def _send_phase(target_rps: int, duration_s: int, station_ids: list[str]):
    """Sends messages at the target rate (the real, controlled input side of the
    measurement) and records send timestamps + keys for later latency lookup."""
    thread_local = threading.local()

    def _sqs_for_thread():
        client = getattr(thread_local, "sqs", None)
        if client is None:
            client = _client("sqs")
            thread_local.sqs = client
        return client

    sqs_main = _client("sqs")
    queue_url = sqs_main.get_queue_url(QueueName=QUEUE_NAME)["QueueUrl"]

    total = target_rps * duration_s
    interval = 1.0 / target_rps
    sent = []  # (send_time, key)
    send_failures = 0

    def _task(seq):
        station_id = station_ids[seq % len(station_ids)]
        body, ts = _make_message(station_id, seq)
        t0 = time.monotonic()
        try:
            _sqs_for_thread().send_message(QueueUrl=queue_url, MessageBody=body)
        except Exception:
            return None
        return (t0, {"station_id": station_id, "event_type_timestamp": f"weather_event#{ts}"})

    results = [None] * total
    with concurrent.futures.ThreadPoolExecutor(max_workers=min(100, max(8, target_rps * 2))) as pool:
        futures = {}
        wall_start = time.monotonic()
        for seq in range(total):
            futures[pool.submit(_task, seq)] = seq
            target_elapsed = (seq + 1) * interval
            actual_elapsed = time.monotonic() - wall_start
            sleep_for = target_elapsed - actual_elapsed
            if sleep_for > 0:
                time.sleep(sleep_for)
        send_wall_elapsed = time.monotonic() - wall_start
        for fut, seq in futures.items():
            results[seq] = fut.result()

    for r in results:
        if r is None:
            send_failures += 1
        else:
            sent.append(r)

    return sent, send_failures, send_wall_elapsed, queue_url


def _measure_latencies(sent, table):
    """Polls DynamoDB for each sent key until it's queryable; returns list of
    ingest-to-queryable latencies (seconds) for keys that resolved within the timeout."""
    latencies = []
    misses = 0
    overall_deadline = time.monotonic() + POLL_TIMEOUT_S
    pending = list(sent)
    while pending and time.monotonic() < overall_deadline:
        still_pending = []
        for send_time, key in pending:
            item = table.get_item(Key=key).get("Item")
            if item is not None:
                latencies.append(time.monotonic() - send_time)
            else:
                still_pending.append((send_time, key))
        pending = still_pending
        if pending:
            time.sleep(POLL_INTERVAL_S)
    misses = len(pending)
    return latencies, misses


def _queue_depth_series(queue_url, sqs, max_duration_s, interval_s=1.0):
    """Samples ApproximateNumberOfMessages once per interval, in a background thread,
    until either stop_event is set (measurement phase finished) or max_duration_s
    elapses as a safety cap -- so the trace always covers exactly this level's run."""
    samples = []
    stop_event = threading.Event()
    stop_at = time.monotonic() + max_duration_s

    def _run():
        while not stop_event.is_set() and time.monotonic() < stop_at:
            t0 = time.monotonic()
            try:
                attrs = sqs.get_queue_attributes(
                    QueueUrl=queue_url,
                    AttributeNames=["ApproximateNumberOfMessages", "ApproximateNumberOfMessagesNotVisible"],
                )["Attributes"]
                samples.append(
                    {
                        "t": round(t0, 2),
                        "visible": int(attrs["ApproximateNumberOfMessages"]),
                        "in_flight": int(attrs["ApproximateNumberOfMessagesNotVisible"]),
                    }
                )
            except Exception:
                pass
            stop_event.wait(interval_s)

    thread = threading.Thread(target=_run, daemon=True)
    thread.start()
    return thread, samples, stop_event


def run_level(label: str, target_rps: int, duration_s: int, station_ids: list[str]):
    ddb = boto3.resource(
        "dynamodb",
        endpoint_url=ENDPOINT,
        region_name=REGION,
        aws_access_key_id=os.environ.get("AWS_ACCESS_KEY_ID", "test"),
        aws_secret_access_key=os.environ.get("AWS_SECRET_ACCESS_KEY", "test"),
    )
    table = ddb.Table(TABLE_NAME)
    sqs = _client("sqs")

    # sample queue depth continuously through send phase + drain-observation window;
    # stop_event lets us end the trace the instant this level's measurement finishes,
    # so consecutive levels' traces never overlap regardless of how long draining takes
    depth_window_s = duration_s + POLL_TIMEOUT_S
    depth_thread, depth_samples, depth_stop = _queue_depth_series(
        sqs.get_queue_url(QueueName=QUEUE_NAME)["QueueUrl"], sqs, depth_window_s
    )

    sent, send_failures, send_wall_elapsed, queue_url = _send_phase(target_rps, duration_s, station_ids)
    latencies, misses = _measure_latencies(sent, table)

    depth_stop.set()
    depth_thread.join()
    peak_depth = max((s["visible"] + s["in_flight"] for s in depth_samples), default=0)

    latencies.sort()

    def pctile(p):
        if not latencies:
            return None
        idx = min(len(latencies) - 1, int(round(p * (len(latencies) - 1))))
        return latencies[idx]

    return {
        "label": label,
        "target_rps": target_rps,
        "duration_s": duration_s,
        "messages_sent": len(sent),
        "send_failures": send_failures,
        "send_wall_elapsed_s": round(send_wall_elapsed, 3),
        "achieved_send_rps": round(len(sent) / send_wall_elapsed, 2) if send_wall_elapsed else None,
        "processed": len(latencies),
        "unprocessed_within_timeout": misses,
        "peak_queue_depth": peak_depth,
        "queue_depth_samples": depth_samples,
        "p50_s": round(pctile(0.50), 4) if latencies else None,
        "p95_s": round(pctile(0.95), 4) if latencies else None,
        "p99_s": round(pctile(0.99), 4) if latencies else None,
        "min_s": round(latencies[0], 4) if latencies else None,
        "max_s": round(latencies[-1], 4) if latencies else None,
        "mean_s": round(statistics.mean(latencies), 4) if latencies else None,
    }


def lambda_concurrency_snapshot():
    lam = _client("lambda")
    cfg = lam.get_function_concurrency(FunctionName="greengrid-ingest-handler-fn")
    return cfg.get("ReservedConcurrentExecutions")


def queue_snapshot():
    sqs = _client("sqs")
    qurl = sqs.get_queue_url(QueueName=QUEUE_NAME)["QueueUrl"]
    return sqs.get_queue_attributes(
        QueueUrl=qurl,
        AttributeNames=["ApproximateNumberOfMessages", "ApproximateNumberOfMessagesNotVisible"],
    )["Attributes"]


if __name__ == "__main__":
    stations = [f"station-load-{i}" for i in range(8)]
    print(f"[{time.strftime('%Y-%m-%dT%H:%M:%S')}] starting load test against {ENDPOINT}")
    print(f"ingest Lambda reserved concurrency: {lambda_concurrency_snapshot()}")
    print(f"queue before run: {queue_snapshot()}")
    print()

    results = []
    for label, rps, dur in LOAD_LEVELS:
        print(f"--- running level '{label}': target {rps} req/s for {dur}s ---")
        summary = run_level(label, rps, dur, stations)
        printable = {k: v for k, v in summary.items() if k != "queue_depth_samples"}
        results.append(summary)
        print(json.dumps(printable, indent=2))
        print()
        time.sleep(3)  # brief settle between levels

    print("=== FINAL SUMMARY (depth samples omitted, see JSON file) ===")
    print(
        json.dumps(
            [{k: v for k, v in r.items() if k != "queue_depth_samples"} for r in results],
            indent=2,
        )
    )

    with open(os.path.join(os.path.dirname(__file__), "run-output.json"), "w") as f:
        json.dump(results, f, indent=2)
    print(f"\nfull results (incl. queue depth samples) written to load/run-output.json")
