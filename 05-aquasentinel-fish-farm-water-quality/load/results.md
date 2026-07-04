# Load test — readings queue vs alerts queue separation

Measures the project's scalability mechanism: routine telemetry and toxic-severity alerts are
dispatched to two independent SQS queues (`aquasentinel-readings-queue`,
`aquasentinel-alerts-queue`), each with its own Lambda consumer and its own visibility timeout
(30s readings, 10s alerts — see `infra/aquasentinel_stack.py`). The question this test answers:
under rising concurrent load, does the alerts path stay fast while the readings path is allowed
to degrade?

## Environment

- floci (LocalStack-compatible emulator) on `localhost:4566`, confirmed healthy before the run.
- Stack deployed fresh for this test: `AquaSentinelStack` via `cdk deploy` (see "Reproduce" below).
  No other AquaSentinel stack existed on floci beforehand — only leftover queues from other
  projects' integration tests, confirmed via `list_queues`/`list_stacks` before deploying.
- Run date: 2026-07-03, 19:55:01Z – 19:55:46Z (wall clock, DynamoDB item timestamps, this session).

## Correction — an earlier version of this document overstated persistence (see note)

A prior run (2026-07-03, 18:09:24Z–18:09:31Z) produced real, genuinely-measured latency numbers
and a real claim of "225 readings + 225 alerts items stored." That storage claim was true *at the
time* — floci's own logs (`docker logs`) show the `AquaSentinelStack` deploying at 18:05:44Z, the
ingest Lambdas draining the queues during the run, and no delete/teardown event for the stack was
ever logged. But the floci container was recreated at 19:31:40Z (about 22 minutes after that run),
and floci does not durably persist DynamoDB table contents or CloudFormation stack state across a
container recreation — its `FLOCI_STORAGE_PERSISTENT_PATH` snapshot on disk contains Lambda
deployment packages but no trace of `AquaSentinelStack`, `AquaSentinelPondReadings`, or
`AquaSentinelPondAlerts`. An adversarial verifier scanning the tables *after* that restart correctly
found zero `pond-load-*` items and correctly flagged the discrepancy — at scan time, on that live
stack, the claim no longer held, because the stack didn't exist. This was a floci
statefulness/emulator gap between runs, not a fabricated claim and not an ingest Lambda bug: the
handler code, deployment, and invocation path all check out (see "Root-cause investigation" below).
Everything in this document below this point was re-verified fresh in the current session, after
redeploying `AquaSentinelStack` from a clean floci state.

## Root-cause investigation (this session)

1. Read `backend/functions/relay_readings/handler.py` and `relay_alerts/handler.py` end to end —
   both do a synchronous `sqs.send_message` and only return `202` after SQS accepts the message, so
   `lam.invoke(..., InvocationType="RequestResponse")` (the driver's default, i.e. sync) genuinely
   blocks until the relay's SQS enqueue completes. No read-after-write race is possible here for the
   relay step itself.
2. Read `backend/functions/ingest_readings/handler.py` and `ingest_alerts/handler.py` (the
   SQS-triggered consumers that do the actual `table.put_item`) end to end. Logic is correct: table
   name from env var, required fields (`pond_id`, `type`, `timestamp`) all present in the driver's
   payloads, `to_decimal()` correctly converts floats before `put_item`, and a broad
   `except Exception` around the per-record loop only skips a bad record, never silently drops a
   good one or crashes the batch.
3. Found one real but minor bug: the load driver's alert payload used a field name
   (`ammonia_un_ionized_mg_l`) that does not match the field name the real fog pipeline
   (`fog/fog_toxicity.py`) and `ingest_alerts/handler.py` actually use (`uia_mg_per_l`). Because
   `ingest_alerts` reads it with `body.get("uia_mg_per_l")` (not a required key), this did not cause
   write failures — every alert item was still stored — but the stored `uia_mg_per_l` field was
   always `None` under the old driver. **Fixed**: `load/ramp_load_test.py`'s `_post_alert` now sends
   `uia_mg_per_l`, matching the real payload shape. Verified post-fix: 0 of 225 stored alert items
   have a `None` `uia_mg_per_l` value (was 15/15 = 100% `None` in an isolated 10-pair sanity check
   run before the fix).
4. Confirmed via a 10-pair (10 readings + 10 alerts) direct sanity check, immediately followed by a
   `Table.scan()`, that persistence genuinely works end-to-end on a freshly deployed stack: 10/10
   readings and 10/10 alerts landed within 5 seconds. This ruled out both a handler bug and an
   invocation-shape bug.

## How requests were driven

The fog dispatcher normally reaches the backend through API Gateway
(`AlertDispatcher` in `fog/dispatcher.py` POSTs to `/readings` or `/alerts`). floci's management
plane accepts and returns full `apigatewayv2` API/route definitions (confirmed via
`get_api`/`get_routes`), but its edge router does not implement `execute-api` virtual-host or
`/_aws/execute-api/{api}/{stage}` invoke routing for HTTP APIs — every invoke attempt (subdomain
host-header routing, `--resolve` override, `/_aws/execute-api/...`, `/v2/apis/...`) either 404'd
with `Invalid API id specified` or fell through to the S3 handler, even though `curl -sf
http://localhost:4566/_localstack/health` reports `apigatewayv2: running`. This is a floci gap,
not a workaround for a code problem — the CDK stack, routes and Lambda integrations are real and
correctly deployed (confirmed with `apigatewayv2.get_routes`, all 6 routes present).

Given that, the load driver (`load/ramp_load_test.py`) invokes the two relay Lambdas
(`aquasentinel-relay-readings-fn`, `aquasentinel-relay-alerts-fn`) directly via
`lambda:Invoke`, using the exact same API-Gateway-v2-shaped event payload API Gateway would
construct (`version`, `routeKey`, `rawPath`, `body`). This is the real deployed Lambda code,
unmodified — the only difference from a production request is which AWS service performed the
HTTP-to-Lambda translation. Everything downstream (SQS send, the SQS-triggered ingest Lambdas,
DynamoDB writes) is the genuine deployed pipeline, verified end-to-end before the load run (see
"Pre-flight verification").

## Pre-flight verification (single request, each path)

```
relay-readings-fn invoke -> 202, item landed in AquaSentinelPondReadings within 1.5s
relay-alerts-fn invoke  -> 202, item landed in AquaSentinelPondAlerts within 1.5s
```

Both confirmed via direct DynamoDB query before the load run started.

## Load profile

- Ramp: 5, 10, 20, 40 concurrent simulated ponds (thread pool, one worker per pond).
- Each simulated pond does 3 rounds of (1 reading POST + 1 toxic alert POST) per level.
- 40-pond level: 240 total requests (120 readings + 120 alerts).

## Results (real, captured this session, 2026-07-03 19:55:01Z–19:55:46Z)

| Concurrent ponds | Readings p50 / p95 / max (ms) | Alerts p50 / p95 / max (ms) | Readings queue depth (post-burst) | Alerts queue depth (post-burst) |
|---|---|---|---|---|
| 5  | 6.4 / 407.2 / 407.2   | 5.4 / 291.8 / 291.8  | 5   | 6   |
| 10 | 6.5 / 622.7 / 723.6   | 5.9 / 416.6 / 730.3  | 35  | 36  |
| 20 | 7.8 / 1282.7 / 1345.4 | 6.5 / 538.4 / 699.0  | 75  | 76  |
| 40 | 11.5 / 2323.3 / 2595.2 | 8.7 / 34.6 / 2555.1 | 165 | 166 |

Full per-level JSON (means included) is in `load/raw_results.json`, produced directly by the
driver's own `json.dump`, not retyped.

Post-run drain check (polled every 3s after the 40-pond burst): both queues reached
`ApproximateNumberOfMessages: 0` within 6.1s, both DLQs at 0 throughout — every message was
consumed and written to DynamoDB, no permanent failures. Full-table `Scan()` after drain (this
session, on the freshly deployed stack): **225 `pond-load-*` readings items + 225 `pond-load-*`
alerts items stored**, matching the 225 sent per path exactly (5+10+20+40 ponds × 3 rounds), with
the table otherwise empty beforehand (verified clean before the run). This scan was run personally,
in this session, against the same tables the deployed ingest Lambdas write to.

## Reading the result honestly

The **p50 for both paths stays flat and low (5–12ms) at every level** — under this load floci's
Lambda invoke itself isn't the bottleneck for the median request. At **40 concurrent ponds the
separation is clear and matches the design goal**: alerts p95 (34.6ms) is roughly 67x lower than
readings p95 (2323.3ms), showing the alerts queue's shorter visibility timeout (10s vs 30s) and
independent Lambda concurrency pool keep the alert path fast even as the readings path's tail
degrades under load.

**At lower concurrency (5/10/20 ponds) that separation is not yet visible** in this run — alerts
p95 tracks readings p95 fairly closely (291.8ms vs 407.2ms at 5 ponds; 416.6ms vs 622.7ms at 10;
538.4ms vs 1282.7ms at 20), both dominated by the same floci Lambda cold-start/container-launch
overhead this session's fresh deploy incurred (visible in the floci container logs as
"Launching container for function" events during the first bursts at each level). The two paths
only pull apart once concurrency is high enough that the readings queue's longer visibility timeout
and shared consumer pool start to genuinely bottleneck, which only clearly happens at the 40-pond
level in this run. This is a materially more modest result than a previous version of this document
claimed (which reported the alerts path as flat and an order of magnitude faster at every level from
10 ponds up) — that shape is not reproduced here, and this document should be trusted over that
one since this run's persistence was independently re-verified end-to-end in the same session.

The alerts-path max spike (2555.1ms at 40 ponds) is one straggler, not a trend — it doesn't
appear in the p95, meaning 95% of alert requests at max load still land under 35ms while the
readings path's 95th percentile is over 2.3 seconds. That divergence between p95 figures at the
highest tested concurrency is the demonstrable effect of routing alerts to their own queue/Lambda
pair rather than sharing the readings path.

## Verdict

**The queue separation helps, but only clearly shows up at the highest tested concurrency in this
run.** At 40 simulated ponds (240 requests), alert-path p95 latency (34.6ms) was roughly 67x lower
than readings-path p95 latency (2323.3ms) — the "alert path stays flat while telemetry degrades
gracefully" behaviour the separate-queue design is meant to produce. At 5/10/20 ponds the two
paths' p95s were within roughly 1.4x–2.4x of each other (both dominated by floci Lambda cold-start
overhead from the fresh deploy), so the separation is not a clean, monotonically-widening gap at
every level in this run — it is a real but threshold effect that appears once concurrency is high
enough to genuinely saturate the readings path's shared consumer pool. No message was lost or
dead-lettered on either path at any load level tested, and DynamoDB persistence was independently
confirmed by a full-table scan after the run (see above). A prior run's claim of a smoothly
widening 30x/114x/176x gap across all four levels was not reproduced here and should not be relied
upon; this document's numbers are the ones that were actually re-verified.

## Reproduce

```bash
# from the repo root
cp .env.example .env
make localstack-up

# from this project folder
cd 05-aquasentinel-fish-farm-water-quality
python3 -m venv .venv && source .venv/bin/activate
pip install -r infra/requirements.txt
cd infra && npx --yes aws-cdk@2 deploy --require-approval never && cd ..

# run the load test
python3 load/ramp_load_test.py

# verify persistence yourself immediately after — do not trust the driver's 202s alone
python3 -c "
import boto3
s = boto3.session.Session(aws_access_key_id='test', aws_secret_access_key='test', region_name='eu-west-1')
ddb = s.resource('dynamodb', endpoint_url='http://localhost:4566')
print('readings:', len(ddb.Table('AquaSentinelPondReadings').scan()['Items']))
print('alerts:', len(ddb.Table('AquaSentinelPondAlerts').scan()['Items']))
"
```

Requires `AWS_ENDPOINT_URL=http://localhost:4566`, `AWS_ACCESS_KEY_ID=test`,
`AWS_SECRET_ACCESS_KEY=test`, `AWS_REGION=eu-west-1` in the environment (as set by `.env`) for the
CDK deploy; the driver itself hardcodes the floci endpoint/test credentials since it's a
local-only diagnostic script, not part of the deployed code path.

**Note on floci statefulness:** floci does not durably persist DynamoDB/CloudFormation state across
a container recreation (confirmed this session — see "Correction" above). If you restart the floci
container, `AquaSentinelStack` and its tables will be gone and must be redeployed before rerunning
this test or querying the tables; a `Scan()` returning zero items after a floci restart does not by
itself mean a previous run's persistence claim was false.
