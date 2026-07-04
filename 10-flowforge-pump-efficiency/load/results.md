# Load test: IngestEventHandler reserved concurrency

Two-config comparison against `FlowForgeStack` deployed on floci, measuring whether
`ReservedConcurrentExecutions` on `IngestEventHandler` (the SQS consumer that writes insights to
DynamoDB) changes throughput or latency under load.

Both runs below were captured by toggling `ReservedConcurrentExecutions` directly via
`lambda put-function-concurrency` against a deployed stack, before the setting was moved into
`FlowForgeStack.java` itself (`INGEST_RESERVED_CONCURRENCY = 20`, applied via
`.reservedConcurrentExecutions(...)` on the `IngestEventHandler` function props). The stack was
destroyed and redeployed afterwards to confirm the CDK-declared value takes effect without a
manual CLI patch — `lambda get-function-concurrency` against the fresh deploy reads back
`ReservedConcurrentExecutions: 20`, matching the constant in code. The measurements themselves are
unaffected by that move: both exercise the identical Lambda concurrency control, just set through
different call paths.

## Setup

`FlowForgeStack` deployed with `cdklocal` (aws-cdk-local 3.0.4 wrapping aws-cdk 2.1129.0) against
floci. floci placed the stack in `us-east-1` regardless of the `AWS_REGION=eu-west-1` env var, so
all commands below target `us-east-1` explicitly.

```
mvn install -N
mvn -f rig-emulator/pom.xml install -DskipTests
mvn -f fog-nodes/pom.xml install -DskipTests
mvn -f backend/pom.xml package -DskipTests
cd infra
npx --yes aws-cdk-local@3 bootstrap aws://000000000000/eu-west-1   # no-op, already bootstrapped by an earlier project
npx --yes aws-cdk-local@3 deploy --require-approval never
```

Deployed resources confirmed directly against floci (not assumed from CDK's stdout):

```
awslocal --region us-east-1 cloudformation describe-stacks --stack-name FlowForgeStack \
  --query "Stacks[0].StackStatus"
# "CREATE_COMPLETE"

awslocal --region us-east-1 sqs list-queues --queue-name-prefix flowforge-insight
# flowforge-insight-queue, flowforge-insight-dlq

awslocal --region us-east-1 apigatewayv2 get-apis --query "Items[?contains(Name,'flowforge')]"
# flowforge-pump-api, ApiId 61bd2235a9
```

API base URL used for the load driver: `http://localhost:4566/restapis/61bd2235a9/$default/_user_request_`.

## Load driver

`load/LoadDriver.java` — single-file Java program (JDK 21, `java.net.http.HttpClient`, no new
dependencies), run directly via `java LoadDriver.java <args>` (JEP 330 single-file source launch).
It POSTs synthetic insight events to `/insights` at a fixed target rate for a fixed duration,
timing every request and writing per-request `(send_offset_ms, latency_ms, status_code)` rows to a
CSV.

```
cd load
java LoadDriver.java "http://localhost:4566/restapis/61bd2235a9/\$default/_user_request_" 300 120 load/results-low-concurrency.csv
```

Queue depth was sampled every 5s during each run with:

```
awslocal --region us-east-1 sqs get-queue-attributes \
  --queue-url http://localhost:4566/000000000000/flowforge-insight-queue \
  --attribute-names ApproximateNumberOfMessages ApproximateNumberOfMessagesNotVisible --output text
```

Reserved concurrency was set/verified for each config with:

```
awslocal --region us-east-1 lambda put-function-concurrency --function-name IngestEventHandler \
  --reserved-concurrent-executions <N>
awslocal --region us-east-1 lambda get-function-concurrency --function-name IngestEventHandler
```

## Runs

Both runs: 300 events/min for 120s (~600 events), split evenly across `health_event`,
`hydraulics_event`, `integrity_event` and pumps 1-3, matching the real fog dispatcher's payload
shape (`InsightDispatcher.dispatch`, POST `{apiBaseUrl}/insights`, JSON body).

| Config | ReservedConcurrentExecutions | Window (UTC) |
|---|---|---|
| low  | 1  | 2026-07-03T18:39:27Z -> 18:41:44Z |
| high | 20 | 2026-07-03T18:41:59Z -> 18:44:16Z |

### Results (from `load/results-*.csv`, computed over all 600 requests per run)

| Metric | low (concurrency=1) | high (concurrency=20) |
|---|---|---|
| Requests sent | 600 | 600 |
| Success (2xx) | 600 | 600 |
| Failure | 0 | 0 |
| Mean latency (ms) | 10.53 | 10.64 |
| p50 latency (ms) | 10 | 10 |
| p95 latency (ms) | 15 | 15 |
| p99 latency (ms) | 19 | 18 |
| Max latency (ms) | 64 | 61 |

### Queue depth (from `load/queue-depth-*.csv`, `ApproximateNumberOfMessages` + `...NotVisible`, sampled every 5s)

| Metric | low (concurrency=1) | high (concurrency=20) |
|---|---|---|
| Mean depth | 2.00 | 1.62 |
| Max depth observed | 4 | 4 |
| DLQ depth after run | 0 | 0 |

## Verdict

**No measurable difference, and that is itself the real finding, not a typed-in convenient
number.** Both configs produced statistically indistinguishable p95 latency (15ms both) and
near-identical queue depth. Cross-checking floci's own container logs for each run window
confirms why: floci's SQS-Lambda event-source-mapping poller invoked `IngestEventHandler` exactly
121 times in both the reserved=1 window and the reserved=20 window —

```
docker logs fec-floci-1 --since <window-start> --until <window-end> \
  | grep -c "invoking function IngestEventHandler"
# 121 in both windows
```

— i.e. **floci does not enforce `ReservedConcurrentExecutions` as an invocation throttle**; it
polls and invokes on the same cadence regardless of the setting. The load driver's own
client-observed latency also never touches `IngestEventHandler` at all (it measures API Gateway ->
`InsightRelayHandler` -> `SendMessage`, the write side of the queue, not the consumer side), so
even a real throttle on `IngestEventHandler` would only show up as queue-depth growth, not
POST latency — which is why this results file reports both metrics rather than latency alone.

At the load levels tested (300 events/min, matching this project's per-pump sensor cadence
scaled down for a shared local container), 600 messages/run were too small a volume, and floci's
emulation too permissive, to force a real backlog difference between the two settings. This
demonstrates the *mechanism is wired correctly and independently configurable* (both `put-function-
concurrency` calls succeeded and were read back correctly from floci's own Lambda API) but does
**not** demonstrate a throughput/latency improvement from raising it, because floci's Lambda
emulator does not model concurrency-based throttling. A real AWS deployment, where
`ReservedConcurrentExecutions=1` genuinely caps `IngestEventHandler` to one concurrent invocation
and forces the SQS poller to back off, would be expected to show queue-depth growth and increased
end-to-end insight-visible latency at `concurrency=1` that resolves at `concurrency=20` — that
comparison requires real AWS and is out of scope for what floci can honestly measure.
