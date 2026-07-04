# ChainFrost — Cold-Chain Excursion Sentinel

Simulates a small fleet of refrigerated trucks. Three virtual fog nodes catch temperature
excursions, reefer-unit faults, and telematics events on the truck itself before dispatching
processed events to a scalable AWS backend, visualised on a live fleet dashboard.

## Architecture

- **Sensors** (`reefer-sim/`): 10 sensor topics per truck (temperature, humidity, door, compressor,
  setpoint, GPS, speed, shock, battery), each independently configurable for sample frequency and
  dispatch rate via `sensor-profiles.yaml`, published over MQTT.
- **Fog nodes** (`fog-nodes/`): TempFog (mean-kinetic-temperature excursion detection),
  ReeferHealthFog (door/compressor/battery fault correlation), TelematicsFog (GPS thinning +
  harsh-shock detection). Each dispatches processed events to AWS Kinesis.
- **Backend** (`backend/` + `infra/`): Kinesis → Lambda → DynamoDB, exposed via API Gateway.
  Scales via Kinesis shard count and Lambda concurrency.
- **Dashboard** (`dashboard/`): "Frozen Manifest Board" — vanilla JS, no build step.

## Local development

From the repo root:

```
cp .env.example .env
make localstack-up
```

Then, from this folder:

```
cp config/fleet-sim.env.example config/.env   # edit if needed
mvn -pl reefer-sim,fog-nodes,backend,infra -am install -DskipTests
mvn -pl infra -am compile exec:java -Dexec.mainClass=edu.msc.chainfrost.infra.ChainFrostApp   # cdk synth
npx --yes aws-cdk@2 deploy --app "mvn -q -pl infra -am compile exec:java -Dexec.mainClass=edu.msc.chainfrost.infra.ChainFrostApp" --require-approval never
mvn -pl reefer-sim exec:java -Dexec.mainClass=edu.msc.chainfrost.reefersim.ReeferFleetSimApp &
mvn -pl fog-nodes exec:java -Dexec.mainClass=edu.msc.chainfrost.fog.FogRuntimeApp &
```

Dashboard:

```
cd dashboard
npm install
npm run serve
```

## Testing

```
mvn -pl reefer-sim,fog-nodes,backend,infra checkstyle:check   # lint, custom ruleset in checkstyle.xml
mvn -pl reefer-sim,fog-nodes,backend test          # unit tests
mvn -pl integration-test test                       # sensor -> fog -> backend, needs the emulator running
cd dashboard && npm run test:e2e                     # Playwright, functional + visual
```

## Load testing

```
mvn -pl reefer-sim,fog-nodes,backend,infra,load -am install -DskipTests
cd load
AWS_ENDPOINT_URL=http://localhost:4566 mvn -q exec:java -Dexec.mainClass=edu.msc.chainfrost.load.ProvisionStream
AWS_ENDPOINT_URL=http://localhost:4566 LOAD_LEVELS=5,40 READINGS_PER_TRUCK=8 \
  mvn -q exec:java -Dexec.mainClass=edu.msc.chainfrost.load.FleetLoadDriver
```

`ProvisionStream` creates the 4-shard `chainfrost-telemetry-stream` directly via the Kinesis SDK
(needed because `cdk deploy` can't bootstrap against floci — see Deployment below).
`FleetLoadDriver` ramps concurrent simulated trucks through the real `KinesisDispatchClient` and
prints latency/throughput/shard-distribution at each level. Results: [`load/results.md`](load/results.md).

## Deployment

Real AWS deployment uses the same CDK app with no code changes — only the AWS credentials/region
differ (no local-emulator endpoint override is set). Deploy is gated behind manual approval in
GitHub Actions (`chainfrost-production` environment).

**Status**: compiles clean, 43 unit tests pass (9 reefer-sim + 28 fog-nodes + 6 backend),
`SensorToFogToBackendIT` proves the real fog-node and Lambda-handler code against floci's DynamoDB
(3 integration tests), `cdk synth` produces a valid CloudFormation template, dashboard passes 12
Playwright tests (6 functional + 6 visual). Custom-ruleset Checkstyle (`checkstyle.xml`) runs
clean with 0 violations. One-command `cdk deploy`
against floci itself needs the `cdklocal` wrapper (plain `cdk`'s bootstrap flow doesn't target
custom endpoints) — a tooling gap, not a code issue, since the integration test already exercises
the real handler/DynamoDB code paths directly.

Kinesis fan-in load test (real run, not projected): the `chainfrost-telemetry-stream` (4 shards)
was provisioned directly on floci via SDK — same technique the integration test already uses for
DynamoDB — and ramped from 5 to 40 concurrent simulated trucks publishing through the real
`KinesisDispatchClient`. Across two independent runs: 0 dispatch errors at either load level,
records landed roughly evenly across all 4 shards, and per-request PutRecord latency held steady
or improved (not degraded) at 8x the concurrent-truck count (e.g. mean 25.68ms → 6.52ms, p99
189ms → 15ms in run 1). Full numbers, exact commands, and the real-AWS-throttle caveat are in
[`load/results.md`](load/results.md). Full deploy + load test at the brief's original 200-truck
scale runs against real AWS ahead of submission.
