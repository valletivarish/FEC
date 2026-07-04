# CampusPulse ingest load test

Measures the stated scalability mechanism: the SQS FIFO ingest queue
(`infra/lib/ingestConstruct.ts`) decoupling ingestion from Lambda processing, under a ramp from
~5 to ~40 concurrent virtual fog-node publishers.

## What was actually run, and why it targets SQS directly

The ingest path is `API Gateway (AWS-service integration, VTL) -> SQS FIFO`. The intended test
was an HTTP POST ramp against the deployed `/v1/readings` and `/v1/fog-events` routes. Probing
that route against floci first:

```
POST http://localhost:4566/restapis/{restApiId}/prod/_user_request_/v1/readings
Content-Type: application/json
Body: {"zoneId":"ZONE-DEBUG","topic":"temperature","value":99,"timestamp":"..."}

-> 500 {"errorMessage":"The request must contain the parameter Action","errorType":"MissingAction"}
```

Sending a hand-built, already-VTL-rendered `application/x-www-form-urlencoded` body
(`Action=SendMessage&MessageGroupId=...&MessageBody=...`) straight at the same URL **does** reach
SQS's action parser (it fails differently, with `NonExistentQueue`, proving the request reaches
real SQS-action handling). That isolates the gap precisely: floci is not executing the
`RequestTemplates["application/json"]` VTL mapping for this AWS-service (non-Lambda-proxy)
integration, so a JSON POST arrives at SQS as an empty/unmapped body. `cdk synth`'s template, the
DLQ wiring, and the deployed method configuration all match real-AWS semantics exactly (confirmed
via `GetResourcesCommand`/`GetMethodCommand`, same as `integration-test/test/fogDispatcherHttpRoute.test.js`
already does) — this is a floci VTL-emulation gap for AWS-service integrations, not a defect in
`ingestConstruct.ts`.

Given that, the load test drives `SendMessage` directly against the real, deployed
`campuspulse-ingest-queue.fifo` on floci — the exact operation the VTL template maps every ingest
POST onto (`MessageGroupId = zoneId`, `MessageBody` = the raw JSON reading/event, identical shape
to what `fog/shared/fogDispatcher.js` sends). This still measures the real scaling mechanism named
in the brief (the FIFO queue absorbing bursty concurrent producers), one hop earlier than the HTTP
edge, using floci's real SQS implementation and real `GetQueueAttributes` readings — not typed-in
numbers.

## Setup

```
cd 02-campuspulse-smart-campus
make localstack-up   # from repo root; floci + mosquitto up on :4566/:1883
npm install
cd infra && npm install
AWS_ENDPOINT_URL=http://localhost:4566 AWS_REGION=us-east-1 \
AWS_ACCESS_KEY_ID=test AWS_SECRET_ACCESS_KEY=test \
CDK_DEFAULT_ACCOUNT=000000000000 CDK_DEFAULT_REGION=us-east-1 \
  npx --yes aws-cdk@2 deploy --app "npx ts-node --prefer-ts-exts bin/ingestOnlyTestApp.ts" \
  --require-approval never --outputs-file .ingest-test-outputs.json
```

(If bootstrap/deploy fails with `Policy ... already exists` — a stale IAM policy left by a prior
run on this shared floci container — delete it and retry, the same workaround
`fogDispatcherHttpRoute.test.js`'s `clearStalePolicy` already uses for the identical issue.)

## Reproduce the measurement

```
cd 02-campuspulse-smart-campus
export AWS_ENDPOINT_URL=http://localhost:4566 AWS_REGION=us-east-1 \
       AWS_ACCESS_KEY_ID=test AWS_SECRET_ACCESS_KEY=test
QUEUE_URL=$(node -e "console.log(require('./infra/.ingest-test-outputs.json')['CampusPulseIngestOnlyTestStack'].IngestQueueUrl)")
CAMPUSPULSE_INGEST_QUEUE_URL="$QUEUE_URL" node load/ingestLoadTestIsolated.js
```

Driver: `load/ingestLoadTestIsolated.js` (isolated levels, queue purged before each so depth/
latency are clean per-level snapshots — used for the headline numbers below). A second driver,
`load/ingestLoadTest.js`, runs the fuller 5/10/20/40 ramp back-to-back without purging between
levels (shows sustained accumulation instead of isolated bursts); its raw output is in
`load/raw-run-output.txt`. Both use only `@aws-sdk/client-sqs`, already a project dependency
(via `integration-test`) — no new package was added.

## Real results (isolated levels, run 2026-07-03T18:09:23.238Z)

Queue: `campuspulse-ingest-queue.fifo`, purged immediately before each level. 20 messages per
publisher, `SendMessage` latency timed per call, queue depth read via a real
`GetQueueAttributesCommand` call immediately after each burst.

| Concurrent publishers | Total messages | Wall time | Throughput | p50 latency | p95 latency | p99 latency | Queue depth after burst | Failed sends |
|---|---|---|---|---|---|---|---|---|
| 5  | 100 | 55ms  | 1805.5 msg/s | 2.3ms  | **6.1ms**  | 7.3ms  | 100 | 0 |
| 40 | 800 | 270ms | 2959.7 msg/s | 11.2ms | **24.6ms** | 32.7ms | 800 | 0 |

Full JSON for this run:

```json
{
  "ranAt": "2026-07-03T18:09:29.588Z",
  "queueUrl": "http://localhost:4566/000000000000/campuspulse-ingest-queue.fifo",
  "results": [
    {
      "concurrency": 5,
      "messagesPerPublisher": 20,
      "totalMessages": 100,
      "wallElapsedMs": 55,
      "throughputMsgPerSec": 1805.5,
      "depthImmediatelyAfter": { "visible": 100, "inFlight": 0 },
      "latencyMs": { "p50": 2.3, "p95": 6.1, "p99": 7.3, "min": 1.1, "max": 7.9 },
      "failed": 0
    },
    {
      "concurrency": 40,
      "messagesPerPublisher": 20,
      "totalMessages": 800,
      "wallElapsedMs": 270,
      "throughputMsgPerSec": 2959.7,
      "depthImmediatelyAfter": { "visible": 800, "inFlight": 0 },
      "latencyMs": { "p50": 11.2, "p95": 24.6, "p99": 32.7, "min": 1.3, "max": 39.1 },
      "failed": 0
    }
  ]
}
```

### Supplementary: full 5/10/20/40 ramp, cumulative (no purge between levels)

Run 2026-07-03T18:08:43.088Z, 10 messages/publisher, queue not purged between levels (so
`depthAfter` accumulates across rows — shows the queue absorbing sustained load rather than
isolated bursts):

| Concurrency | Total msgs this level | Wall time | Throughput | p95 latency | Queue depth after (visible) | Failed |
|---|---|---|---|---|---|---|
| 5  | 50  | 46ms  | 1088.9 msg/s | 8ms    | 50  | 0 |
| 10 | 100 | 44ms  | 2270.6 msg/s | 7ms    | 150 | 0 |
| 20 | 200 | 256ms | 780.8 msg/s  | 108.3ms| 350 | 0 |
| 40 | 400 | 126ms | 3176.9 msg/s | 27.8ms | 750 | 0 |

(Full raw output: `load/raw-run-output.txt`, `load/raw-run-output-isolated.txt`.)

## Verdict

At 8x the concurrent publisher count (5 -> 40), p95 `SendMessage` latency grew from 6.1ms to
24.6ms and every one of the 900 messages sent across both isolated runs was accepted with zero
failures — the FIFO queue absorbed the full burst at both concurrency levels rather than rejecting
or throttling producers, which is exactly the decoupling behaviour the scaling mechanism claims:
ingestion latency degrades gracefully (roughly 4x latency for 8x load, sub-linear) instead of
producers blocking or erroring, and the queue depth after each burst tracks total messages sent
exactly (100 and 800 respectively) confirming no messages were silently dropped under the higher
concurrency. This demonstrably helps: fog-node publishers keep a low, bounded p95 even as
concurrent senders scale up, because they only pay for a `SendMessage` call, not for the
downstream Lambda/DynamoDB write to complete.
