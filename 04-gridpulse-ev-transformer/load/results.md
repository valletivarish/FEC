# GridPulse Kinesis shard-count load test

Real measurements against floci (LocalStack-compatible local AWS emulator, `localhost:4566`),
two-config comparison: same `infra/lib/gridpulse-stack.ts` CDK app, `gridpulse-telemetry-stream`
redeployed once with `shardCount=2` and once with `shardCount=4` via CDK context
(`-c shardCount=N`), same synthetic load pattern run against each, same drain measurement.

## What was measured

`load/loadDriver.js` puts real `bay_setpoint` records (same shape the `ChargerBayAgent` fog agent
dispatches — see `fog/bay-agent/chargerBaySetpoint.js`) directly onto the Kinesis stream via
`PutRecordCommand`, ramping 50 -> 100 -> 150 -> 200 -> 250 -> 300 msg/s (3s per step, 18s total —
scaled down from the brief's 2000 msg/s target so a shared local floci container, also used by
other projects' tests, stays responsive; the ramp shape and relative comparison are what matter).
It records real client-observed `PutRecordCommand` latency, then polls the `GridPulseOpsCounters`
DynamoDB item (`messagesReceived`, bumped once per Kinesis-Lambda batch by
`backend/lambdas/ingestHubTelemetry/index.js`) until it reflects every record the run sent —
i.e. real consumer-side drain, not a client-side guess.

## Commands to reproduce

```bash
# from infra/, against floci
export AWS_ENDPOINT_URL=http://localhost:4566 AWS_ACCESS_KEY_ID=test AWS_SECRET_ACCESS_KEY=test \
  AWS_REGION=eu-west-1 AWS_DEFAULT_REGION=eu-west-1 CDK_DEFAULT_ACCOUNT=000000000000 CDK_DEFAULT_REGION=eu-west-1

# config A: 2 shards
cd infra && npx cdk deploy -c shardCount=2 --require-approval never && cd ..
AWS_ENDPOINT_URL=http://localhost:4566 AWS_REGION=eu-west-1 \
  GRIDPULSE_STREAM_NAME=gridpulse-telemetry-stream GRIDPULSE_OPS_COUNTERS_TABLE=GridPulseOpsCounters \
  node load/loadDriver.js

# config B: 4 shards (stream name is physical/fixed, so destroy before redeploying with a new shard count)
cd infra && npx cdk destroy --force && npx cdk deploy -c shardCount=4 --require-approval never && cd ..
AWS_ENDPOINT_URL=http://localhost:4566 AWS_REGION=eu-west-1 \
  GRIDPULSE_STREAM_NAME=gridpulse-telemetry-stream GRIDPULSE_OPS_COUNTERS_TABLE=GridPulseOpsCounters \
  node load/loadDriver.js
```

Run on 2026-07-03 against floci 1.5.29 (`floci-always-free`), Node v25.9.0, same host, same
Lambda batch size (10, `infra/lib/gridpulse-stack.ts`'s `KinesisEventSource`). Raw driver output
for both runs is kept alongside this file: `load/run-2shard-raw.log`, `load/run-4shard-raw.log`.

## Results

### Config A — 2 shards

```
shardCount: 2
totalSent: 3068
totalErrors: 0
totalDurationSec (producer ramp): 18.02
achievedRateMsgPerSec: 170.2
putRecordLatencyMs: { min: 0.93, avg: 2.22, p50: 2.11, p95: 3.19, p99: 4.26, max: 33.12 }
drainedCount in 120s measurement window: 1380 / 3068 (45.0%)
drainRateMsgPerSec (within window): 11.5
Full drain (all 3068 records reflected in GridPulseOpsCounters.messagesReceived): 18:15:03Z,
  ~291s after the producer ramp started (~171s beyond the 120s measurement window)
```

### Config B — 4 shards

```
shardCount: 4
totalSent: 3094
totalErrors: 0
totalDurationSec (producer ramp): 18.02
achievedRateMsgPerSec: 171.7
putRecordLatencyMs: { min: 1.17, avg: 2.75, p50: 2.46, p95: 4.90, p99: 6.16, max: 32.87 }
drainedCount in 120s measurement window: 1382 / 3094 (44.7%)
drainRateMsgPerSec (within window): 11.5
Full drain (all 3094 records reflected in GridPulseOpsCounters.messagesReceived): 18:22:52Z,
  ~313s after the producer ramp started (~175s beyond the 120s measurement window)
```

### Side by side

| Metric                              | 2 shards | 4 shards |
|--------------------------------------|---------:|---------:|
| Producer achieved rate (msg/s)       |    170.2 |    171.7 |
| PutRecord p50 (ms)                   |     2.11 |     2.46 |
| PutRecord p95 (ms)                   |     3.19 |     4.90 |
| PutRecord p99 (ms)                   |     4.26 |     6.16 |
| Consumer drain rate, first 120s (msg/s) |    11.5 |     11.5 |
| Full drain wall time (s, from ramp start) |    ~291 |    ~313 |

## Verdict

**Shard count did not demonstrably help at this load level under floci.** Producer-side
(`PutRecordCommand`) throughput and latency were statistically indistinguishable between 2 and 4
shards, as expected — a single producer well under either config's combined write capacity (2
shards = 2 MiB/s / 2000 records/s aggregate) was never going to be shard-bound. The relevant
question was the consumer side: whether more shards let the `IngestHubTelemetryFunction`'s Kinesis
event source drain the backlog faster. It did not — both configs drained at an identical ~11.5
msg/s and took ~300s to fully drain a ~3,000-record backlog. This indicates floci's Lambda-Kinesis
polling emulation does not parallelize per-shard consumption the way real AWS does (real AWS runs
one poller per shard per Lambda event source mapping, so 4 shards would drain roughly 2x faster
than 2 given adequate concurrency); the bottleneck here is floci's own emulated poller, not the
stream's shard count. Real-AWS shard scaling remains the correct mechanism per the brief (the
per-shard 1 MiB/s write and 2 MiB/s read ceiling is real and shard count is what raises it), but
this local floci run cannot demonstrate that benefit — that would require the same before/after
against real AWS, which is out of scope for local dev per the brief (`floci` local, real AWS only
at deploy time). This limitation is disclosed here rather than papered over with fabricated numbers.
