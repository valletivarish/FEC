# FlowForge — Utility Pump-Farm Efficiency Analytics

A Java edge-to-cloud pipeline for a 3-pump farm. Ten sensors per pump feed three fog nodes that
watch for point anomalies, slow drift, hydraulic efficiency loss, and seal integrity risk,
dispatching only triaged insights into a scalable AWS backend with a live dashboard.

## Architecture

- **Sensors** (`rig-emulator/`): 10 sensor metrics per pump (vibration, bearing temp, motor
  current, inlet/outlet pressure, flow rate, seal leak, RPM, power draw, turbidity), each
  independently configurable for sample and dispatch cadence via per-pump YAML config, published
  over MQTT.
- **Fog nodes** (`fog-nodes/`): HealthNode (Iglewicz-Hoaglin robust z-score for point anomalies,
  a parallel two-sided CUSUM change-point detector for slow drift, plus a heartbeat), HydraulicsNode
  (derived efficiency vs. an RPM-dependent affinity-law baseline, 3-cycle debounced WARNING, an
  immediate-bypass CRITICAL path for severe deviation), IntegrityNode (dual-threshold hysteresis
  state machine for seal leak, with a trend-slope escalation from LEAK_WATCH to LEAK_CRITICAL).
  Dispatches to the backend over HTTP.
- **Backend** (`backend/` + `infra/`): API Gateway → SQS → Lambda → DynamoDB. The `/insights`
  POST route is served by a relay Lambda that forwards the raw body onto the insight queue,
  so the fog dispatcher's HTTP call actually has somewhere to land. Scales via SQS load-leveling
  and `IngestEventHandler`'s reserved concurrency (`INGEST_RESERVED_CONCURRENCY` in
  `FlowForgeStack.java`), load-tested in `load/` (see `load/results.md`).
- **Dashboard** (`dashboard/`): Bootstrap 5 — navbar, tables, cards, and semantic badges, themed
  with a rust/burnt-orange accent.

## Local development

From the repo root:

```
cp .env.example .env
make localstack-up
```

Then, from this folder:

```
mvn install -N
mvn -f rig-emulator/pom.xml install -DskipTests
mvn -f fog-nodes/pom.xml install -DskipTests
mvn -f backend/pom.xml package -DskipTests
cd infra && npx --yes aws-cdk@2 deploy --require-approval never && cd ..
MQTT_BROKER_URL=tcp://localhost:1883 java -jar rig-emulator/target/rig-emulator-1.0.0.jar pump-01.yaml &
java -jar fog-nodes/target/fog-nodes-1.0.0.jar
```

Dashboard:

```
cd dashboard && npm install && npm run serve
```

## Testing

```
mvn -f rig-emulator/pom.xml checkstyle:check
mvn -f fog-nodes/pom.xml checkstyle:check
mvn -f backend/pom.xml checkstyle:check
mvn -f rig-emulator/pom.xml test
mvn -f fog-nodes/pom.xml test
mvn -f backend/pom.xml test
mvn -f rig-emulator/pom.xml install -DskipTests
mvn -f fog-nodes/pom.xml install -DskipTests
mvn -f backend/pom.xml install -DskipTests
cd integration-test && \
  AWS_ENDPOINT_URL=http://localhost:4566 AWS_ACCESS_KEY_ID=test AWS_SECRET_ACCESS_KEY=test \
  AWS_REGION=eu-west-1 AWS_DEFAULT_REGION=eu-west-1 FLOWFORGE_INSIGHTS_TABLE=flowforge-insights-table \
  FLOWFORGE_TARGET_QUEUE_URL=http://localhost:4566/000000000000/flowforge-it-relay-queue \
  mvn test
cd dashboard && npm run test:e2e
```

## Deployment

Real AWS deployment uses the same CDK app with no code changes — the AWS SDK v2 default client
builder reads `AWS_ENDPOINT_URL`/`AWS_REGION` from the environment natively; omitting them targets
real AWS. Deploy is gated behind manual approval in GitHub Actions (`flowforge-production`
environment).

**Status**: Checkstyle (custom ruleset, `checkstyle.xml`) passes clean on all 5 modules. 64 unit
tests pass (25 sensors, 32 fog, 7 backend), 5 integration tests prove the real
HealthNode/HydraulicsNode/IntegrityNode logic and the Lambda handler against floci's DynamoDB,
plus the insight-relay Lambda's HTTP-to-SQS path against floci's SQS, `cdk synth` produces a valid
template, dashboard passes 20 Playwright tests (functional + visual, across desktop and mobile
viewports).

Two bugs found and fixed:

1. The initial 5-agent parallel generation returned an EMPTY `infra/` module (the agent produced
   no files at all). Caught during the standard post-generation file check, fixed by a targeted
   follow-up build that read the two sibling Java projects' (ChainFrost, FloodWatch) infra modules
   as reference templates and self-verified via a real `cdk synth` before finishing.
2. `fog-nodes/pom.xml` omitted explicit version numbers on several dependencies (Jackson, JUnit,
   Mockito), assuming they'd be inherited from the parent POM's `dependencyManagement` — but the
   parent only manages the AWS SDK BOM, so the build failed immediately with "version is missing"
   errors. Fixed by adding explicit versions (reusing the parent's `${junit.version}`/
   `${mockito.version}` properties where already declared).
3. The CDK stack wired the insight queue only as a Lambda event source — there was no API Gateway
   route matching the `/insights` path `InsightDispatcher` actually POSTs to, so the fog layer's
   HTTP call would 404 against a real or floci deployment despite integration tests passing (they
   called `IngestEventHandler` directly, bypassing HTTP/API-Gateway/SQS entirely). Fixed by adding
   `InsightRelayHandler`, a thin Lambda that relays the raw POST body onto the insight queue via
   `sqs:SendMessage` (least-privilege, scoped to that one queue), wired to a new `POST /insights`
   route. Proved against floci with a real `SendMessage`/`ReceiveMessage` round trip, not a mock.
4. Adding Checkstyle surfaced one genuine unused import (`java.util.ArrayList` in
   `HydraulicsNode.java`, left over from an earlier draft). Removed.
5. `turbidity` readings reached `IntegrityNode.onReading` but were dropped by its metric filter,
   so the sensor never surfaced past the fog layer. Fixed by tracking the latest turbidity per
   pump and using it as a corroborating signal: heavy contamination alongside a leak already in
   `LEAK_WATCH` now escalates straight to `LEAK_CRITICAL` even without a steep seal-leak trend,
   and turbidity is attached to the dispatched `integrity_event`. Separately, `HealthNode` already
   computed `motorCurrent`/`rpm` into its `health_event` payload but `pumpHealthTable.js` never
   rendered them — added as two more columns, no fog-layer change needed.

`FlowForgeStack` was deployed against floci with `cdklocal` (bootstrap + `deploy`, resources
confirmed via `awslocal cloudformation describe-stacks`/`sqs list-queues`/`apigatewayv2 get-apis`,
not assumed from CDK's stdout) and load-tested with a two-config comparison: 600 synthetic
`/insights` POSTs (300/min for 120s) at `IngestEventHandler` reserved concurrency 1 vs. 20, with
per-request latency timed by a plain JDK `HttpClient` driver (`load/LoadDriver.java`) and queue
depth sampled from floci's own `sqs get-queue-attributes` every 5s. Result: p95 latency and queue
depth were statistically identical between the two configs (15ms both; full numbers and the exact
reproduction commands in `load/results.md`) — cross-checking floci's container logs showed it
invokes the SQS-triggered Lambda on the same poll cadence regardless of
`ReservedConcurrentExecutions`, i.e. floci doesn't emulate Lambda's concurrency throttling, so this
setup proves the mechanism is wired correctly and independently configurable (now set in
`FlowForgeStack.java`, not just via CLI) but can't demonstrate the throughput difference a real AWS
deployment would show. Full `cdk deploy` + this same comparison against real AWS ahead of
submission, where the throttling behaviour floci can't emulate should actually show up.
