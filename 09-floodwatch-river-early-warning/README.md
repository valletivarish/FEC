# FloodWatch — River Flood Early-Warning

A Java edge-to-cloud pipeline for a 3-reach river catchment. Ten sensors per reach feed three fog
nodes that classify flood stage, water quality, and storm risk — including a genuine cross-reach
correlation where a catchment-wide storm pattern detected by one reach's fog node can escalate a
neighboring reach's flood-stage classifier before its own river-level threshold is crossed.

## Architecture

- **Sensors** (`river-gauge-sim/`): 10 sensor metrics per reach (river level, flow rate, rainfall,
  water temperature, turbidity, dissolved oxygen, pH, conductivity, soil saturation, barometric
  pressure), each independently configurable for sample and dispatch cadence via per-reach YAML
  config, published over MQTT.
- **Fog nodes** (`fog-nodes/`): HydroFogNode (rate-of-rise + GREEN/AMBER/RED staging, thresholds
  tightened when soil is saturated, accelerated dispatch cadence once AMBER/RED), QualityFogNode
  (weighted Composite Water Quality Index plus an immediate contamination check), MeteoFogNode
  (pressure-trend pre-storm detection feeding a shared `CatchmentCorrelator` — when at least 2 of
  3 reaches report heavy rainfall AND at least 1 has a pre-storm pressure signal, the confirming
  reach's own HydroFogNode is escalated one stage, auto-expiring after 4 ticks if not confirmed by
  the real threshold). Dispatches to the backend over HTTP.
- **Backend** (`backend/` + `infra/`): API Gateway → SQS → Lambda → DynamoDB. Fog nodes POST to
  `/events`, relayed by a thin Lambda straight onto the intake queue (no re-validation — that's
  the intake Lambda's job); the dashboard polls `/reaches/{reachId}/status` via a second route.
  Scales via SQS load-leveling and Lambda concurrency.
- **Dashboard** (`dashboard/`): Bootstrap 5 — navbar, tables, cards, and semantic badges, themed
  with a river-blue-cyan accent.
- **Load driver** (`load/`): standalone AWS SDK v2 driver that ramps direct `Invoke` traffic at
  `ReachIntakeHandler` to exercise its reserved-concurrency scalability mechanism; see
  [`load/results.md`](load/results.md) for the real before/after measurement.

## Local development

From the repo root:

```
cp .env.example .env
make localstack-up
```

Then, from this folder:

```
mvn install -N
mvn -f river-gauge-sim/pom.xml install -DskipTests
mvn -f fog-nodes/pom.xml install -DskipTests
mvn -f backend/pom.xml package -DskipTests
cd infra && AWS_ENDPOINT_URL=http://localhost:4566 AWS_ACCESS_KEY_ID=test AWS_SECRET_ACCESS_KEY=test \
  AWS_REGION=eu-west-1 AWS_DEFAULT_REGION=eu-west-1 CDK_DEFAULT_ACCOUNT=000000000000 \
  CDK_DEFAULT_REGION=eu-west-1 npx --yes aws-cdk@2 deploy --require-approval never && cd ..
java -jar river-gauge-sim/target/river-gauge-sim-1.0.0.jar reach-upper.yaml &
java -jar fog-nodes/target/fog-nodes-1.0.0.jar
```

The gauge sim reads its MQTT broker URL from the reach's own YAML (`src/main/resources/reach-*.yaml`),
not an environment variable, so it needs no `MQTT_BROKER_URL` export — the shipped YAMLs already
point at `tcp://localhost:1883`. `FogRuntimeApp` does read `FLOODWATCH_API_BASE_URL` (defaulting to
`http://localhost:8080`) and `FLOODWATCH_MQTT_BROKER_URL`; set `FLOODWATCH_API_BASE_URL` to the
`ApiEndpoint` output printed by `cdk deploy` above so fog events actually reach the deployed API.

Dashboard:

```
cd dashboard && npm install && npm run serve
```

Open `http://localhost:8100` and set `window.FLOODWATCH_API_BASE_URL` (see `index.html`) to the
same `cdk deploy` `ApiEndpoint` output before loading the page, or the dashboard shows its
no-live-data empty state.

## Testing

```
mvn -f river-gauge-sim/pom.xml checkstyle:check
mvn -f fog-nodes/pom.xml checkstyle:check
mvn -f backend/pom.xml checkstyle:check
mvn -f infra/pom.xml checkstyle:check
mvn -f integration-test/pom.xml checkstyle:check
mvn -f river-gauge-sim/pom.xml test
mvn -f fog-nodes/pom.xml test
mvn -f backend/pom.xml test
mvn -f river-gauge-sim/pom.xml install -DskipTests
mvn -f fog-nodes/pom.xml install -DskipTests
mvn -f backend/pom.xml install -DskipTests
cd integration-test && \
  AWS_ENDPOINT_URL=http://localhost:4566 AWS_ACCESS_KEY_ID=test AWS_SECRET_ACCESS_KEY=test \
  AWS_REGION=eu-west-1 AWS_DEFAULT_REGION=eu-west-1 FLOODWATCH_STAGE_TABLE=floodwatch-reach-stage \
  mvn test
cd dashboard && npm run test:e2e
```

## Deployment

Real AWS deployment uses the same CDK app with no code changes — the AWS SDK v2 default client
builder reads `AWS_ENDPOINT_URL`/`AWS_REGION` from the environment natively; omitting them targets
real AWS. Deploy is gated behind manual approval in GitHub Actions (`floodwatch-production`
environment).

**Status**: 68 unit tests pass (17 sensors, 39 fog, 12 backend), 5 integration tests prove the real
HydroFogNode/QualityFogNode/MeteoFogNode/CatchmentCorrelator logic — including the full cross-reach
escalation path — the Lambda handler against floci's DynamoDB, and the `/events` relay Lambda
against a real floci SQS queue, `cdk synth` produces a valid template, dashboard passes 28
Playwright tests (13 functional + 2 visual regression, each across desktop and mobile viewports).
`mvn checkstyle:check` (custom ruleset, `checkstyle.xml`) is clean across all 5 modules.

Five bugs found and fixed:

1. The infra module's CDK stack referenced the backend Lambda asset as
   `floodwatch-backend-1.0.0.jar`, but the backend module's real Maven artifact is
   `backend-1.0.0.jar` — a naming assumption that never matched between the two independently
   generated modules. Fixed by correcting the asset path in `FloodWatchStack.java`.
2. The generated dashboard already wrapped tables in Bootstrap cards but was missing the pill-
   shaped badges and navbar monogram from the project's standing polish direction — added both
   directly (a small, mechanical fix) rather than a full redesign pass.
3. `ReachEventDispatcher` POSTs to `${apiBaseUrl}/events`, but the CDK stack only ever wired the
   intake queue as an SQS event source for `ReachIntakeHandler` — there was no API Gateway route
   an HTTP POST could actually reach, so the fog→backend path only worked in in-process tests, not
   over real HTTP. Fixed by adding `ReachEventRelayHandler` (relays the raw POST body onto the
   intake queue unparsed; `ReachIntakeHandler` still owns all validation) and a `POST /events`
   route in `FloodWatchStack.java`, with `sqs:SendMessage` scoped to the intake queue's own ARN
   only.
4. `FogRuntimeApp`'s metric-routing sets covered only 9 of the 10 sensor metrics — `flow-rate`
   matched none of HYDRO_METRICS/QUALITY_METRICS/METEO_METRICS and was silently dropped before
   reaching any fog node, backend, or dashboard view. Fixed by adding `flow-rate` to
   `HYDRO_METRICS` and giving `HydroFogNode` a genuine use for it: a windowed regression slope of
   flow-rate is compared against the existing river-level rate-of-rise slope, and a rising level
   paired with flat/falling discharge is flagged `blockageSuspected` (a real hydrology signal for
   an upstream obstruction, distinct from the existing saturation-amplified threshold check) and
   forces a dispatch on its own. Surfaced on `hydro_event` as `flowRateSlope`/`blockageSuspected`
   and added to the Reach Overview table.
5. `HydroFogNode` already computed `soilSaturationAmplified` (whether soil-saturation had tightened
   this reach's flood-stage thresholds) on every `hydro_event`, but no dashboard component ever
   rendered it — soil-saturation was the one sensor type genuinely processed by a fog node with no
   visible representation anywhere in the UI. Fixed by adding a "Soil Saturation" column to the
   Reach Overview table (`reachOverviewTable.js`) and a matching Playwright assertion, rather than
   inventing a new fog computation for it.

Scalability mechanism (reserved concurrency on the gauge-intake Lambda) load-tested against
floci: capping `ReachIntakeHandler` at `reservedConcurrentExecutions=2` and ramping direct
`Invoke` traffic 5→60 req/s held p95 latency at 977ms with only 11/620 calls throttled; the same
ramp against the unconstrained (default-concurrency) deploy drove floci's own container pool to
exhaustion, dropping success to 0/620 and 134/620 across two repeats with p95 at or near the 15s
client timeout. Full method, real numbers, and reproduction commands in
[`load/results.md`](load/results.md). Full `cdk deploy` + load test against real AWS still ahead
of submission — this was run against floci only.
