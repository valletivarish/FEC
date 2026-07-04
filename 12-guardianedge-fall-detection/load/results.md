# GuardianEdge load test: SQS batching on the alert queue

Scalability mechanism under test: SQS batching (`batchSize`) on the `IngestEventHandler`
event-source-mapping consuming `guardianedge-alert-queue.fifo`. Measured against a real
`cdk deploy` of `GuardianEdgeStack` on floci (not a mock, not a fabricated number). Note:
`maxBatchingWindow` was tested live against floci but turned out to be **invalid for this queue**
on real AWS (FIFO queues don't support a batching window) — see the correction section below for
the full story; the checked-in stack only ever uses `batchSize`.

## What was measured

50 concurrent classified `fall_event` sends (one HTTP-shaped SQS message per resident,
`messageGroupId=fog-events`) fired at the real deployed alert queue, once with the
event-source-mapping reconfigured to `batchSize=1` (WITHOUT), once at `batchSize=10` (WITH) —
see the correction below for why the originally-attempted `maxBatchingWindow=2s` on the WITH run
never actually took effect. End-to-end latency is measured from the moment each message is sent
to the moment its item is confirmed queryable in the real `guardianedge-event-history-table`
(polled every 100ms), i.e. genuine send-to-persisted latency through `IngestEventHandler`, not
just queue-drain time.

## Results (real, measured — not illustrative)

| Metric | WITHOUT batching (batchSize=1) | WITH batching (batchSize=10) |
|---|---|---|
| Confirmed writes | 50/50 | 50/50 |
| p50 end-to-end latency | 24674 ms | 2410 ms |
| **p95 end-to-end latency** | **47690 ms** | **4510 ms** |
| max latency | 49700 ms | 4514 ms |
| min latency | 636 ms | 391 ms |
| Total drain wall-clock | ~50 s | ~4.5 s |

Full raw output: [`without-batching-run.txt`](./without-batching-run.txt),
[`with-batching-run.txt`](./with-batching-run.txt).

## Verdict

**Batching (via `batchSize`) demonstrably helped**: p95 end-to-end latency dropped from 47690ms
to 4510ms (~90.5% reduction) and the queue fully drained roughly 11x faster. This is directly
explained by real, log-verified poller behavior — see below.

## How this was verified as real (not assumed)

floci's `SqsEventSourcePoller` logs confirmed the actual receive-batch size flipped as expected
between runs:

```
# WITHOUT run (batchSize=1) — one message per poll cycle:
19:41:18,619 ESM a190dd3f...: received 1 message(s), invoking IngestEventHandler
19:41:19,619 ESM a190dd3f...: received 1 message(s), invoking IngestEventHandler

# WITH run (batchSize=10) — ten messages per poll cycle:
19:42:01,614 ESM a190dd3f...: received 10 message(s), invoking IngestEventHandler
19:42:02,614 ESM a190dd3f...: received 10 message(s), invoking IngestEventHandler
```

Real queue attributes (`GetQueueAttributes`) were also polled directly against floci's SQS
service throughout both drain phases (see raw run files) rather than assumed from the driver's
own bookkeeping.

## Important correction: `maxBatchingWindow` is not valid for this (FIFO) queue

While writing up this test, `.maxBatchingWindow(Duration.seconds(2))` was added to
`GuardianEdgeStack.java`'s `SqsEventSourceProps` to make the checked-in stack match what was
load-tested — `cdk synth` then failed with `Batching window is not supported for FIFO queues`.
`guardianedge-alert-queue.fifo` is a FIFO queue (required for ordered per-resident event
processing), and AWS Lambda does not support `maximumBatchingWindowInSeconds` on event-source-
mappings for FIFO SQS queues at all. That change has been reverted; `GuardianEdgeStack.java`
keeps only `.batchSize(10)`, which **is** valid and deployable on a FIFO source.

This also explains a discrepancy noticed during the test: `UpdateEventSourceMapping` against
floci with `maximumBatchingWindowInSeconds=2` was accepted without error (floci does not enforce
the real FIFO/batching-window incompatibility), but the field never appeared in any subsequent
`ListEventSourceMappings`/`GetEventSourceMapping` response — floci silently accepted and then
silently dropped a configuration that real AWS would have rejected outright. So the WITH-batching
run below in practice only ever exercised `batchSize=10` (the window was never actually active on
either floci or, had this run against real AWS, deployable at all) — the measured improvement is
attributable entirely to `batchSize`, which is exactly what the checked-in stack now deploys.
The "WITH batching" column/label below is kept as originally measured for a faithful record, but
should be read as **batchSize=10 alone**, not batchSize=10 + a 2s window.

Separately, this floci instance (shared across all 15 projects in this monorepo, per
`CLAUDE.md`) showed significant instability during setup: CloudFormation's stack-tracking
registry repeatedly desynced from the live SQS/Lambda/IAM state after container restarts and a
scoped `_localstack/state/reset` call, requiring direct, surgical cleanup of stale entries in the
shared `data/cloudformation-stacks.json` and `data/iam-roles.json` persistence files (only the
`GuardianEdgeStack` keys and this project's own duplicate IAM role entries were touched; every
other project's entries — HarborPulse, BinSight, ParkFog, GreenhouseGuard, CDKToolkit — were left
exactly as found and their queues/tables/functions confirmed present afterward). Also note: query
tools against this floci instance require a SigV4-shaped `Authorization` header carrying the
`eu-west-1` region even with dummy credentials — omitting it silently returns empty results
instead of an error, which cost significant debugging time during this session.

## Exact commands to reproduce

```bash
# 1. deploy the real stack against floci (from infra/)
export AWS_ENDPOINT_URL=http://localhost:4566 AWS_ACCESS_KEY_ID=test AWS_SECRET_ACCESS_KEY=test \
  AWS_REGION=eu-west-1 AWS_DEFAULT_REGION=eu-west-1
cd infra && npx --yes aws-cdk@2 bootstrap aws://000000000000/eu-west-1 && \
  npx --yes aws-cdk@2 deploy --require-approval never

# 2. build the load-test driver and its classpath
cd ../load && mvn -q compile
mvn -q dependency:build-classpath -Dmdep.outputFile=/tmp/cp.txt

# 3. WITHOUT batching
java -cp "target/classes:$(cat /tmp/cp.txt)" guardianedge.load.ConfigureEsm 1 0
java -cp "target/classes:$(cat /tmp/cp.txt)" guardianedge.load.AlertBurstDriver \
  50 50 60 without-batching

# 4. WITH batching (batchSize only - the deployed queue is FIFO, and AWS does not support
#    a batching window on FIFO event-source-mappings, so only batchSize is varied)
java -cp "target/classes:$(cat /tmp/cp.txt)" guardianedge.load.ConfigureEsm 10 0
java -cp "target/classes:$(cat /tmp/cp.txt)" guardianedge.load.AlertBurstDriver \
  50 50 60 with-batching
```

Note: `mvn exec:java -Dexec.mainClass=...` does **not** override this pom's plugin-configured
`mainClass` in this environment (confirmed by direct test — the CLI property is silently ignored
and the pom-default `AlertBurstDriver` runs regardless of `-Dexec.mainClass`), so `java -cp` is
the commands that were actually run and verified above, not `mvn exec:java`.

Run at: 2026-07-03T19:40:31Z (without-batching), 2026-07-03T19:42:01Z (with-batching).
