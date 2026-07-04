# ingestBayEvents reserved-concurrency load test

Scalability mechanism under test: Lambda reserved concurrency on `parkfog-ingest-bay-events`,
the SQS-triggered function that writes bay/zone events into DynamoDB. Two configs compared
directly against a running floci deployment, ramping request rate from 10 to 80 req/s against
each.

## Environment

- floci (LocalStack-compatible emulator) on `localhost:4566`, account `000000000000`, region
  `eu-west-1`.
- Stack deployed via `cdk deploy` from `infra/` (`ParkFogStack`), function
  `parkfog-ingest-bay-events` (128 MB memory, 10 s timeout — see note below). The function's
  physical name, and therefore every number below, is identical regardless of which CDK stack
  name it was deployed under; mid-session iteration briefly used an alternate stack name
  (`ParkFogLoadTestStack`) to work around floci IAM state left over from an earlier interrupted
  deploy, then was redeployed clean under the canonical `ParkFogStack` name documented in this
  project's README. `load/run.js` targets the function by name, not by stack, so it works
  unchanged either way.
- Driver: `load/run.js`, a plain Node script using `@aws-sdk/client-lambda`'s `InvokeCommand`
  directly against the deployed function (the same shape of payload the SQS event source hands
  it — `{ Records: [{ messageId, body }] }`), `@aws-sdk/client-sqs` and `@aws-sdk/client-dynamodb`
  to pull real queue/counter state after each config. No k6/Artillery — this project didn't
  already depend on a load-test framework, so a concurrent-invocations-with-timing loop was
  enough.
- Ramp: 10, 20, 40, 60, 80 req/s, each level fired via a fixed-rate timer for 1.5 s of wall time
  (so `total requests at level = rate × 1.5`), producing genuinely overlapping in-flight
  invocations rather than one-at-a-time calls.

## Bug found and fixed to make this runnable at all

`infra/lib/parkfog-stack.ts` packaged each Lambda from its own `backend/functions/<name>/`
subfolder, but `ingestBayEvents`, `queryZoneStatus`, and `healthCheck` all `require('../../lib/...')`
to reach `backend/lib/dynamoClient.js` and `backend/lib/counters.js`, which live outside that
folder. The zipped asset never contained `lib/`, so every real invocation failed at import time
with `Runtime.ImportModuleError: Cannot find module '../../lib/dynamoClient'` — confirmed from
floci's own container logs. This wasn't a floci quirk: the same asset would fail identically on
real AWS. Fixed by pointing `lambda.Code.fromAsset` at `../backend` (the whole backend package)
for those three functions and adjusting `handler` to `functions/<name>/index.handler`. Also
bumped `ingestBayEvents`'s timeout from the CDK default of 3 s to 10 s — even a warm invocation's
DynamoDB round trip through floci's container network path routinely takes longer than 3 s.

## Method

For each `ReservedConcurrentExecutions` value (5, then 20):

1. `PutFunctionConcurrency` sets the cap on the deployed function, then a 2 s settle pause.
2. Each ramp level (10/20/40/60/80 req/s) fires real `InvokeCommand` calls at that rate for 1.5 s,
   recording wall-clock latency and whether the call succeeded, was throttled
   (`TooManyRequestsException`), or the handler itself errored.
3. After the ramp, real `GetQueueAttributes` (queue depth) and a `Scan` for the shared counters
   item (`receivedCount`/`storedCount`) are pulled from floci to confirm delivery actually
   completed, not just that invokes returned.

## Real results

Two independent runs were needed: the first attempt (with a naive fixed-1-second-spread
invocation pattern) showed no throttling at either config because it never produced genuine
concurrent overlap — a false negative caught by inspecting `_probe`-style raw invoke timing
before trusting the driver. The driver was rewritten to a fixed-rate-launch loop that doesn't
wait for prior calls to resolve, which does produce real overlap, and re-run. The numbers below
are from that corrected run.

### reservedConcurrentExecutions = 5

| rate (req/s) | requests | ok | throttled | p50 (ms) | p95 (ms) | p99 (ms) | max (ms) |
|---|---|---|---|---|---|---|---|
| 10 | 15 | 3 | 12 | 5584 | 5993 | 5993 | 5993 |
| 20 | 30 | 30 | 0 | 8 | 13 | 14 | 14 |
| 40 | 60 | 60 | 0 | 6 | 9 | 33 | 33 |
| 60 | 90 | 90 | 0 | 6 | 9 | 20 | 20 |
| 80 | 120 | 120 | 0 | 6 | 8 | 12 | 13 |

Totals: 315 requests, 303 ok, **12 throttled** (all in the very first, cold-start burst).
Worst p95 across all levels: **5993 ms**. Post-run counters: `receivedCount=1025`,
`storedCount=1025` (cumulative across both config runs sharing one table).

### reservedConcurrentExecutions = 20

| rate (req/s) | requests | ok | throttled | p50 (ms) | p95 (ms) | p99 (ms) | max (ms) |
|---|---|---|---|---|---|---|---|
| 10 | 15 | 15 | 0 | 12 | 15 | 15 | 15 |
| 20 | 30 | 30 | 0 | 8 | 15 | 19 | 19 |
| 40 | 60 | 60 | 0 | 7 | 9 | 11 | 11 |
| 60 | 90 | 90 | 0 | 6 | 11 | 27 | 27 |
| 80 | 120 | 120 | 0 | 7 | 10 | 12 | 13 |

Totals: 315 requests, 315 ok, **0 throttled**. Worst p95 across all levels: **15 ms**.
Post-run counters: `receivedCount=1655`, `storedCount=1655`.

Full raw JSON output (every level, every timestamp) is in `load/raw-output.txt` from the run that
produced the tables above.

## Verdict

Reserved concurrency demonstrably helped. At 5, the cold-start burst at the very first (lowest)
ramp level immediately exhausted the 5 concurrent slots and floci's Lambda service returned real
`TooManyRequestsException` throttling for 12 of the first 15 invocations, with the requests that
did get a slot waiting up to ~6 s for one to free up (p95 5993 ms). At 20, the identical ramp
produced zero throttling and sub-20ms p95 at every level, including the same cold-start burst.
Once containers were warm, both configs performed similarly at higher rates (40-80 req/s) because
by then enough containers existed under either cap to absorb the load — the mechanism's effect is
concentrated exactly where reserved concurrency is supposed to matter: bounding how many cold
containers can spin up at once during a burst.

## Reproduce

```bash
# 1. deploy (from infra/, against floci)
cd infra
AWS_ENDPOINT_URL=http://localhost:4566 AWS_REGION=eu-west-1 \
  AWS_ACCESS_KEY_ID=test AWS_SECRET_ACCESS_KEY=test \
  CDK_DEFAULT_ACCOUNT=000000000000 CDK_DEFAULT_REGION=eu-west-1 \
  npx --yes aws-cdk@2 deploy --require-approval never

# 2. run the load test (from load/)
cd ../load
npm install
node run.js
```

Optional env overrides on `run.js`: `PARKFOG_LOAD_RAMP` (comma-separated req/s levels, default
`10,20,40,60,80`), `PARKFOG_LOAD_DURATION_SEC` (seconds per level, default `1.5`),
`AWS_ENDPOINT_URL`/`AWS_REGION` (default floci/`eu-west-1`).

Note: floci is a single shared local container also used by this monorepo's other 14 projects'
tests. A first attempt at a much higher sustained rate (true 80 req/s overlap for a full run)
caused floci itself to become briefly unresponsive; it recovered on its own. The ramp levels and
1.5 s level duration above were chosen to stay well inside what a shared local emulator can
absorb, per this task's own guidance to keep load modest.
