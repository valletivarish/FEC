# GuardianEdge — Remote Elder-Care Fall Detection

A Java edge-to-cloud pipeline for 3 residents in independent care-apartment rooms. Ten wearable
and room sensors feed three fog nodes that watch vital-sign deterioration, confirm genuine falls
from an accelerometer/gyroscope signature, and track occupancy and comfort, dispatching only
classified events into a scalable AWS backend with a live "CareWatch Console" dashboard.

## Architecture

- **Sensors** (`sensor-sim/`): 10 sensor metrics per resident (heartrate, spo2, resprate,
  skintemp, ecgrr, accelerometer, gyroscope, room-pir, room-ambienttemp, room-airquality), each
  independently configurable for sample and dispatch cadence via per-resident YAML config,
  published over MQTT.
- **Fog nodes** (`fog-runtime/`): VitalsFogNode (per-vital hysteresis state machine with a
  3-consecutive-reading debounce, SDNN-derived HRV, and a low-HRV compounding rule that escalates
  a WARNING straight to CRITICAL), FallFogNode (5-state FSM — MONITORING → FREE_FALL → IMPACT →
  STILLNESS_CONFIRM → FALL_CONFIRMED — with a false-positive-suppression revert path when normal
  movement is detected during stillness confirmation), PresenceFogNode (debounced occupancy,
  an independent day-hours inactivity timer, and occupancy-gated comfort checks). Dispatches to
  the backend over HTTP.
- **Backend** (`backend/` + `infra/`): API Gateway → SQS FIFO → Lambda → DynamoDB, plus a
  DynamoDB-Streams-triggered alert processor that rolls fall/critical-vitals/inactivity events
  into a live per-resident alert count. Scales via SQS load-leveling and Lambda concurrency.
- **Dashboard** (`dashboard/`): "CareWatch Console" — a large-type, single-column, vertical
  list-group layout (deliberately not a table, card-grid, tabs, or accordion, to keep this
  project's dashboard structurally distinct from every sibling project), cream/deep-teal/coral
  palette built for a non-technical carer audience.

## Local development

From the repo root:

```
cp .env.example .env
make localstack-up
```

Then, from this folder:

```
mvn install -N
mvn -f sensor-sim/pom.xml install -DskipTests
mvn -f fog-runtime/pom.xml install -DskipTests
mvn -f backend/pom.xml package -DskipTests
cd infra && npx --yes aws-cdk@2 deploy --require-approval never && cd ..
MQTT_BROKER_URL=tcp://localhost:1883 java -jar sensor-sim/target/sensor-sim-1.0.0.jar &
java -jar fog-runtime/target/fog-runtime-1.0.0.jar
```

Dashboard:

```
cd dashboard && npm install && npm run serve
```

## Testing

```
mvn -f sensor-sim/pom.xml test
mvn -f fog-runtime/pom.xml test
mvn -f backend/pom.xml test
mvn -f sensor-sim/pom.xml install -DskipTests
mvn -f fog-runtime/pom.xml install -DskipTests
mvn -f backend/pom.xml install -DskipTests
cd integration-test && \
  AWS_ENDPOINT_URL=http://localhost:4566 AWS_ACCESS_KEY_ID=test AWS_SECRET_ACCESS_KEY=test \
  AWS_REGION=eu-west-1 AWS_DEFAULT_REGION=eu-west-1 \
  GUARDIANEDGE_HISTORY_TABLE=guardianedge-event-history-table \
  GUARDIANEDGE_STATUS_TABLE=guardianedge-resident-status-table \
  mvn test
cd dashboard && npm run test:e2e
```

## Deployment

Real AWS deployment uses the same CDK app with no code changes — the AWS SDK v2 default client
builder reads `AWS_ENDPOINT_URL`/`AWS_REGION` from the environment natively; omitting them targets
real AWS. Deploy is gated behind manual approval in GitHub Actions (`guardianedge-prod`
environment).

**Status**: 69 unit tests pass (20 sensor-sim, 34 fog-runtime, 15 backend), 6 integration tests
prove the real VitalsFogNode/FallFogNode/PresenceFogNode logic and all 3 Lambda handlers
(ingest, alert-processor via the derived risk-state upsert, and the resident-query/acknowledge
read API) against floci's DynamoDB — including a scripted free-fall sequence that dispatches
exactly one `FALL_CONFIRMED` event and lands `currentRiskState=CRITICAL`. `cdk synth` produces a
valid template, dashboard passes 16 Playwright tests (functional + visual, across desktop and
mobile viewports) with the populated-data visual snapshots inspected by hand, not just trusted
from a passing assertion, after a prior sibling project's dashboard passed its own weak assertion
while silently rendering the empty state.

No new integration bugs found this build — the fetch-binding fix and Playwright caret-version
pin discovered on prior sibling projects were both pre-empted directly in the generation brief and
verified correct on first read (`fetch.bind(globalThis)` in `careWatchApiClient.js`,
`"@playwright/test": "^1.47.0"` in `dashboard/package.json`), and the backend/infra jar-filename
contract (`backend-1.0.0.jar`) matched exactly on first `cdk synth`.

**Load test**: `cdk deploy` was run against floci and the alert queue's SQS-batching scalability
mechanism (`batchSize` on `IngestEventHandler`'s event-source-mapping — `maxBatchingWindow` is not
usable here since the alert queue is FIFO and AWS does not support a batching window on FIFO
event sources) was measured with a genuine WITH/WITHOUT comparison — 50 concurrent classified
`fall_event` sends, once at `batchSize=1` and once at `batchSize=10`, with end-to-end latency
measured from send to confirmed-persisted in the real `guardianedge-event-history-table`. Measured
p95 latency dropped from 47690ms (without batching) to 4510ms (with batching), a ~90.5% reduction,
corroborated by floci's own event-source-poller logs showing the receive-batch size flip from 1 to
10 message(s) per poll cycle between runs. Full methodology, raw output, and exact reproduction
commands: [`load/results.md`](load/results.md).
