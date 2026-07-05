# BinSight — Smart Waste Collection & Dynamic Routing

A Java edge-to-cloud pipeline for a depot running 3 street bins and 1 collection truck. Ten
sensors feed three fog nodes that cross-check fill against weight for sensor faults, score fire
risk from methane/temperature/tilt, and build a ranked, truck-assigned collection work-list by
cross-referencing the other two nodes' own verdicts — dispatching only classified events into a
scalable AWS backend with a live admin-style operations dashboard.

## Architecture

- **Sensors** (`sensor-emitters/`): 10 sensor metrics across bins/truck/depot (fill-level,
  bin-weight, lid-state, internal-temp, methane-ppm, tilt, truck-gps, hopper-fill, fuel-level,
  weighbridge-tonnage), each independently configurable for sample and dispatch cadence via
  per-entity YAML config, published over MQTT.
- **Fog nodes** (`collection-fog/`): BinClusterNode (expected-weight-band cross-check against fill
  level, flags `POSSIBLE_FALSE_FULL`/`INCONSISTENT`, batched every 8th tick), BinSafetyNode
  (median-smoothed, weighted fire-risk score, immediate unbatched dispatch while CRITICAL),
  FleetNode (GPS geofence decimation, and — the cross-node node — builds a ranked due-for-collection
  work-list by consuming BinClusterNode's and BinSafetyNode's own dispatched events, not raw sensor
  data, plus nearest-neighbour truck assignment; the latest truck-gps/hopper-fill/fuel-level values
  ride along on this same work-list event as `fleetTelemetry`, since those 3 raw sensor types have
  no dispatch path of their own). Dispatches to the backend over HTTP via a
  `BinSightEventDispatcher` with a CRITICAL-only 3-attempt fixed-backoff retry.
- **Backend** (`backend/` + `infra/`): API Gateway → SQS → Lambda → DynamoDB, split across 3
  independently-scalable queues (cluster verdicts, fire risk, work lists) so a fire-risk alert
  storm never starves work-list refreshes. Also includes an `IngestRelayHandler` — the same Lambda
  code deployed 3 times behind 3 POST routes, each relaying its HTTP body onto its own SQS queue —
  see "Architectural note" below for why this exists.
- **Dashboard** (`dashboard/`): a plain admin-style operations board — a dark sidebar with icon
  nav, a white header, a KPI summary row of real aggregate counts, a grid of colored bin risk tiles
  (not a table), and a literal `<canvas>` 2D depot map plotting bin/truck positions.
- **Load test** (`load/`): a standalone burst-load driver for the fire-risk queue, used to
  measure the reserved-concurrency scalability mechanism — see "Deployment" below.

## Architectural note: the ingest-relay fix

While building this project, a real gap was found across sibling projects 1–13: each one's fog
layer POSTs to an HTTP path (e.g. `/events`) that no API Gateway route in that project's own CDK
stack actually backs — only integration tests (which call Lambda handlers directly, bypassing
HTTP/API-Gateway/SQS) ever exercised the sensor-to-backend path. In a real deployment, those POSTs
would 404. BinSight fixes this for itself with `IngestRelayHandler`: a small Lambda, deployed once
per queue with only its target queue URL varying, that relays the raw HTTP body onto SQS — and
`integration-test/src/test/java/binsight/it/SensorToFogToBackendIT.java`'s
`the_ingest_relay_handler_actually_delivers_an_http_posted_body_onto_the_real_sqs_queue` test proves
the exact `handleRequest` code path lands a message on a real (floci) queue. Retrofitting the other
13 projects is tracked separately and deliberately out of scope for this project's own build.

## Local development

From the repo root:

```
cp .env.example .env
make localstack-up
```

Then, from this folder:

```
mvn install -N
mvn -f sensor-emitters/pom.xml install -DskipTests
mvn -f collection-fog/pom.xml install -DskipTests
mvn -f backend/pom.xml package -DskipTests
cd infra && npx --yes aws-cdk@2 deploy --require-approval never && cd ..
MQTT_BROKER_URL=tcp://localhost:1883 java -jar sensor-emitters/target/sensor-emitters-1.0.0.jar &
java -jar collection-fog/target/collection-fog-1.0.0.jar
```

Dashboard:

```
cd dashboard && npm install && npm run serve
```

## Testing

```
mvn -pl sensor-emitters,collection-fog,backend,infra,integration-test checkstyle:check   # lint, custom ruleset in checkstyle.xml
mvn -f sensor-emitters/pom.xml test
mvn -f collection-fog/pom.xml test
mvn -f backend/pom.xml test
mvn -f sensor-emitters/pom.xml install -DskipTests
mvn -f collection-fog/pom.xml install -DskipTests
mvn -f backend/pom.xml install -DskipTests
cd integration-test && \
  AWS_ENDPOINT_URL=http://localhost:4566 AWS_ACCESS_KEY_ID=test AWS_SECRET_ACCESS_KEY=test \
  AWS_REGION=eu-west-1 AWS_DEFAULT_REGION=eu-west-1 \
  BINSIGHT_CLUSTER_TABLE=binsight-cluster-verdicts-table \
  BINSIGHT_FIRE_RISK_TABLE=binsight-fire-risk-table \
  BINSIGHT_WORK_LIST_TABLE=binsight-work-list-table \
  BINSIGHT_TARGET_QUEUE_URL=http://localhost:4566/000000000000/binsight-it-relay-queue \
  mvn test
cd dashboard && npm run test:e2e
```

## Deployment

Real AWS deployment uses the same CDK app with no code changes — the AWS SDK v2 default client
builder reads `AWS_ENDPOINT_URL`/`AWS_REGION` from the environment natively; omitting them targets
real AWS. Deploy is gated behind manual approval in GitHub Actions (`binsight-prod` environment).

**Status**: 69 unit tests pass (15 sensor-emitters, 44 collection-fog, 10 backend), 5 integration
tests prove the real BinClusterNode/BinSafetyNode/FleetNode logic — including the cross-node
work-list wiring and the ingest-relay HTTP-to-SQS path — against floci, `cdk synth` produces a
valid template (7 Lambda functions, 6 queues), dashboard passes 16 Playwright tests (functional +
visual, across desktop and mobile viewports) with the populated-data visual snapshots inspected by
hand before accepting them as baselines. Custom-ruleset Checkstyle (`checkstyle.xml`) runs clean
with 0 violations across all 5 Java modules.

One serious bug found and fixed: the initial 5-agent parallel generation returned the ENTIRE
`backend/` module as one-paragraph prose descriptions instead of real Java code (e.g.
`ClusterVerdictIngestHandler.java` literally contained the sentence "SQS-triggered
RequestHandler..." as its whole file content, zero lines of actual code). Caught immediately by
`mvn test` failing to parse the POM at all. Fixed with a dedicated, tightly-scoped regeneration
agent given the sibling modules' real, already-correct source as reference and instructed to
self-verify with a real `mvn test` run before finishing — confirmed independently afterward.

**Scalability mechanism (load-tested)**: reserved concurrency on `FireRiskIngestHandler`,
config-only via `FIRE_RISK_RESERVED_CONCURRENCY` (`infra`'s `BinSightStack.java`). Two burst
pairs (300 messages/20 senders and 150 messages/15 senders) were sent directly onto the real
`binsight-fire-risk-queue` against floci, once with the Lambda unreserved and once with
`reservedConcurrentExecutions(2)`, polling real SQS `GetQueueAttributes` throughout. Results
were inconsistent in direction between the two pairs (300-message pair: reserved drained 40%
slower; 150-message pair: reserved drained faster) — reported honestly as inconclusive on
magnitude/direction rather than picking the cleaner-looking number. What holds across all four
runs: 0 send failures, successful drain-to-zero every time, and `GetFunctionConcurrency`
confirms the setting genuinely takes effect. Full numbers, reproduction commands, and the
emulator-limitation analysis: [`load/results.md`](load/results.md).
