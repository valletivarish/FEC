# GridPulse — EV Charging Hub Load-Balancing & Transformer Protection

A Node.js edge-to-cloud pipeline for a shared-transformer EV charging hub. Ten sensors feed three
in-process fog agents that protect the transformer locally (sub-second, no cloud round trip) and
dispatch only setpoint changes and curtailment transitions into a scalable AWS backend with a live
"Switchboard" dashboard.

## Architecture

- **Sensors** (`sensors/`): 10 sensor metrics across 6 charger bays plus hub-level transformer,
  feeder, and DER (solar/battery/tariff) readings, each independently configurable for sample and
  dispatch cadence via `sensors/config/hub-01.sensors.json`, published over MQTT.
- **Fog agents** (`fog/`): ChargerBayAgent (per-bay CC-CV taper-curve setpoint), TransformerGuardAgent
  (4-rung curtailment ladder with 3-sample de-escalation hysteresis — applies its ceiling to every
  bay agent **in-process, instantly**, and only tells the cloud about rung transitions), DerBalancerAgent
  (solar/battery/tariff mode planner). Dispatches to the backend via Kinesis.
- **Backend** (`backend/` + `infra/`): Kinesis stream → Lambda → DynamoDB, plus an HTTP API for
  hub/bay status queries. Scales via Kinesis shard count and Lambda concurrency.
- **Dashboard** (`dashboard/`): "Switchboard" — plain HTML tables, one restrained accent color per
  status class, no gauges/gradients/glow.

## Local development

From the repo root:

```
cp .env.example .env
make localstack-up
```

Then, from this folder:

```
npm install --prefix sensors && npm install --prefix fog && npm install --prefix backend
cd infra && npm install && npx --yes aws-cdk@2 deploy --require-approval never && cd ..
MQTT_BROKER_URL=mqtt://localhost:1883 npm run start --prefix sensors &
GRIDPULSE_MQTT_URL=mqtt://localhost:1883 node fog/index.js &
```

Dashboard:

```
cd dashboard && npm install && npm run serve
```

## Testing

```
npm test --prefix sensors
npm test --prefix fog
npm test --prefix backend
cd integration-test && npm install && \
  AWS_ENDPOINT_URL=http://localhost:4566 AWS_ACCESS_KEY_ID=test AWS_SECRET_ACCESS_KEY=test \
  AWS_REGION=eu-west-1 AWS_DEFAULT_REGION=eu-west-1 \
  GRIDPULSE_READINGS_TABLE=GridPulseHubSensorReadings GRIDPULSE_CURTAILMENT_TABLE=GridPulseCurtailmentEvents \
  npx jest
cd dashboard && npm run test:e2e
```

## Linting

ESLint (flat config, `eslint.config.js` at this project's root, `eslint:recommended`) covers
sensors/fog/backend/dashboard/integration-test/load with CommonJS vs. ESM globals matched per workspace.

```
npm install
npm run lint --prefix sensors
npm run lint --prefix fog
npm run lint --prefix backend
npm run lint --prefix dashboard
npx eslint --config eslint.config.js load/
```

## Deployment

Real AWS deployment uses the same CDK app with no code changes — the AWS SDK reads
`AWS_ENDPOINT_URL` from the environment natively; omitting it targets real AWS. Deploy is gated
behind manual approval in GitHub Actions (`gridpulse-production` environment).

**Status**: 67 unit tests pass (19 sensors, 37 fog, 11 backend), 4 integration tests prove the real
ChargerBayAgent/TransformerGuardAgent logic and Lambda handler code against floci's DynamoDB,
`cdk synth`/`tsc` produce a valid template, dashboard passes 24 Playwright tests (functional +
visual, across desktop and mobile viewports).

One bug found and fixed during integration testing: sensors publish `category` and `metric` as
separate fields, but all three fog agents match on a combined `"category/metric"` string (e.g.
`"bay/session-power"`) — a genuine contract mismatch between two independently-generated modules
that never saw each other's code. Fixed by normalizing the reading in `fog/shared/sensorSubscriber.js`,
the single point where the wire format is parsed before fog logic ever sees it.

**Load test**: `gridpulse-telemetry-stream` was deployed twice against floci (2 shards, then 4,
`infra/lib/gridpulse-stack.ts`'s `shardCount` is now a CDK context override) and driven with the
same 50->300 msg/s synthetic `bay_setpoint` ramp both times (`load/loadDriver.js`, real
`PutRecordCommand` calls, real consumer drain measured via the `GridPulseOpsCounters` DynamoDB
counter). Producer-side throughput/latency were statistically identical between configs (as
expected — a single producer never approached either config's write ceiling); consumer drain rate
was also identical (~11.5 msg/s, ~300s to fully drain ~3,000 records) in both configs, indicating
floci's Lambda-Kinesis poller emulation doesn't parallelize per shard the way real AWS does. Full
numbers, exact repro commands, and the honest verdict are in `load/results.md`. Real-AWS shard
scaling remains the correct mechanism per the brief; demonstrating its actual effect requires the
same test against real AWS, which this local run cannot substitute for.
