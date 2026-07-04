# GreenGrid load test — SQS ingest queue + reserved Lambda concurrency (20)

Real run against floci (the local AWS emulator), not a projection. Run on 2026-07-03,
stack `GreenGridStack` deployed fresh to floci immediately before the test (see
"Deploy" below). Raw output: `load/run-output.txt` (console) and `load/run-output.json`
(full data incl. per-second queue-depth trace).

## What's being tested

The stated scalability mechanism is **SQS ingest queue with reserved Lambda concurrency
20** on `greengrid-ingest-handler-fn`. That reserved-concurrency setting did not actually
exist in `infra/greengrid_stack.py` before this test — the Lambda was unbounded. It has
been added (`reserved_concurrent_executions=20`) as part of making this measurement
real; see the diff in that file. Confirmed live on the deployed stack:

```
$ python3 -c "...lam.get_function_concurrency(FunctionName='greengrid-ingest-handler-fn')..."
{'ReservedConcurrentExecutions': 20}
```

## Method

The driver (`load/driver.py`) sends station-reading messages directly onto the real
`greengrid-ingest-queue` via `SQS.SendMessage` — this is byte-identical to what
`relay_events.handler` does with a `POST /events` body (`sqs.send_message(QueueUrl=...,
MessageBody=event["body"])`); see `backend/functions/relay_events/handler.py`. Each
message then flows through the *real*, deployed, event-source-mapped ingest Lambda into
the *real* `GreenGridReadings` DynamoDB table on floci. "Ingest-to-queryable" latency is
measured end-to-end: wall-clock time from `SendMessage` returning to the row becoming
readable via `DynamoDB.GetItem` on its exact key — i.e. it includes real SQS visibility
handling, real Lambda cold/warm invocation, and real DynamoDB write-then-read
consistency, not a synthetic stand-in for any of them.

**Why SQS `SendMessage` and not a POST through API Gateway:** floci's HTTP API Gateway
routing (`$default` stage, `_aws/execute-api/...` local URL scheme) did not resolve
requests reliably in this environment. A prior probe also found floci serializes
concurrent Lambda `invoke` (RequestResponse) calls server-side to ~9 req/s regardless of
client-side concurrency — a gateway/invoke-path ceiling, not an ingestion-pipeline one.
Sending directly via `SQS.SendMessage` targets the exact boundary the ingest pipeline
under test actually consumes from, and in isolation sustains 300+ req/s client-side (see
probe below), so it does not itself bottleneck the measurement.

## A real, load-bearing finding: floci's fixed SQS→Lambda drain rate

Before the two official levels below, a probe sent 80 messages in a burst and polled
queue depth once/second:

```
sent 80 messages
118911.7 {'ApproximateNumberOfMessages': '80', ...}
118912.7 {'ApproximateNumberOfMessages': '70', ...}
118913.71 {'ApproximateNumberOfMessages': '60', ...}
...(linear, -10/s)...
118919.74 {'ApproximateNumberOfMessages': '0', ...}
```

floci drains this event-source-mapping (`BatchSize=10`) at a fixed ~10 messages/second —
one batch per poll tick — regardless of the 20-reserved-concurrency ceiling headroom
above it. This is a genuine property of the emulator's SQS-to-Lambda poller, confirmed
via `Lambda.ListEventSourceMappings` (`BatchSize: 10`) and the depth trace above, and it
is the reason ingest-to-queryable latency rises sharply under the high-load level below:
the queue is doing exactly what SQS load-leveling is for — buffering a burst that
arrives faster than the consumer drains it — while the consumer itself is capped by the
emulator, not by this project's Lambda code or its concurrency setting.

## Results

| Level | Target rate | Achieved send rate | Messages sent | Peak queue depth | Processed (no loss) | p50 ingest-to-queryable | p95 ingest-to-queryable | p99 |
|---|---|---|---|---|---|---|---|---|
| low  | 10 req/s | 9.99 req/s | 80  | 3   | 80/80 (100%)   | 4.194s  | **7.615s**  | 7.909s |
| high | 80 req/s | 79.97 req/s | 640 | 560 | 640/640 (100%) | 29.255s | **53.467s** | 56.153s |

Zero `send_failures` at either level. Zero messages lost — all 640 high-load messages
were confirmed processed and queryable in DynamoDB (queue drained to
`ApproximateNumberOfMessages: 0` / `ApproximateNumberOfMessagesNotVisible: 0`
afterwards). Full per-run JSON (including the full per-second queue-depth series for
both levels) is in `load/run-output.json`; raw console output is in
`load/run-output.txt`.

## Verdict

**The scaling mechanism demonstrably worked as SQS load-leveling, but did not keep p95
latency low at 8x load — and that is the honest, correct characterization of what SQS
load-leveling actually buys you here.** Peak queue depth grew from 3 (low) to 560
(high), proving SQS absorbed an 8x burst in arrival rate as a growing backlog rather
than the pipeline rejecting requests, erroring, or losing messages — exactly the
decoupling SQS ingest queues are for. Reserved concurrency 20 kept the ingest Lambda's
resource usage bounded and predictable rather than firing unbounded concurrent
invocations. What it did *not* do, in this specific local-emulator environment, is keep
p95 latency flat under 8x load, because floci's SQS-to-Lambda poller itself drains at a
fixed ~10 msg/s regardless of reserved concurrency headroom — a floci-specific ceiling.
On real AWS the SQS-to-Lambda poller scales pollers roughly in proportion to available
reserved concurrency (up to the 20 configured here), so p95 under the same burst would
be expected to track much closer to the low-load figure; that is a claim for the real-AWS
deployment ahead of submission, not one this floci run can itself prove — this run's
value is in exercising the actual code path end-to-end and proving zero message loss
under an 8x burst, not in producing a number transferable to production capacity
planning.

## Reproduce

```
# 1. deploy (fresh stack, includes the reserved_concurrent_executions=20 fix)
cd infra
source ../.venv/bin/activate
pip install -r requirements.txt
AWS_ENDPOINT_URL=http://localhost:4566 AWS_ACCESS_KEY_ID=test AWS_SECRET_ACCESS_KEY=test \
  AWS_REGION=eu-west-1 AWS_DEFAULT_REGION=eu-west-1 CDK_DEFAULT_ACCOUNT=000000000000 CDK_DEFAULT_REGION=eu-west-1 \
  npx --yes aws-cdk@2 deploy --require-approval never
cd ..

# 2. confirm reserved concurrency is live
python3 -c "
import boto3
lam = boto3.client('lambda', endpoint_url='http://localhost:4566', region_name='eu-west-1', aws_access_key_id='test', aws_secret_access_key='test')
print(lam.get_function_concurrency(FunctionName='greengrid-ingest-handler-fn'))
"

# 3. run the load test
AWS_ENDPOINT_URL=http://localhost:4566 AWS_ACCESS_KEY_ID=test AWS_SECRET_ACCESS_KEY=test \
  AWS_REGION=eu-west-1 AWS_DEFAULT_REGION=eu-west-1 \
  python3 load/driver.py
```

`load/driver.py` writes `load/run-output.json` on every run (overwritten). This
`results.md` reflects the run captured in `load/run-output.txt`, timestamped
`2026-07-03T18:40:32Z` (queue final-drain confirmation).
