# CampusPulse — Smart-Campus Building Operations

A fully Node.js edge-to-cloud pipeline. Ten building sensors across three zones feed three fog
nodes that correlate readings into energy, comfort, and security events, streaming only anomalies
and rollups (not raw telemetry) into a scalable AWS backend with a live dashboard.

## Architecture

- **Sensors** (`sensors/`): 10 sensor topics per zone (electricity, water flow, temperature,
  humidity, light, CO2, door contact, motion, sound, HVAC duct pressure), each independently
  configurable for sample frequency and dispatch rate via `config/sensors.campuspulse.yml`,
  published over MQTT.
- **Fog nodes** (`fog/`): fog-energy (EWMA leak/load anomaly detection), fog-environment (comfort
  index + waste-minutes tracking), fog-security (door+motion+sound occupancy state machine,
  after-hours correlation). Each dispatches processed events to the backend over HTTP.
- **Backend** (`backend/` + `infra/`): API Gateway → SQS FIFO → Lambda → DynamoDB, dashboard
  hosted on S3+CloudFront. Scales via SQS load-leveling and Lambda concurrency.
- **Dashboard** (`dashboard/`): "Floor Plan / Zone Grid" — vanilla JS, no build step.

## Local development

From the repo root:

```
cp .env.example .env
make localstack-up
```

Then, from this folder:

```
npm install
cd infra && npm install && npx --yes aws-cdk@2 deploy --require-approval never && cd ..
MQTT_BROKER_URL=mqtt://localhost:1883 npm run start --workspace=sensors &
MQTT_BROKER_URL=mqtt://localhost:1883 API_BASE_URL=<deployed-api-url> node fog/index.js &
```

Dashboard:

```
cd dashboard && npm run serve
```

## Testing

```
npm test --workspace=sensors
npm test --workspace=fog
npm test --workspace=backend
AWS_ENDPOINT_URL=http://localhost:4566 AWS_ACCESS_KEY_ID=test AWS_SECRET_ACCESS_KEY=test \
  AWS_REGION=us-east-1 CAMPUSPULSE_READINGS_TABLE=CampusPulseReadings \
  CAMPUSPULSE_ALERTS_TABLE=CampusPulseAlerts npm test --workspace=integration-test
cd dashboard && npm run test:e2e
```

## Deployment

Real AWS deployment uses the same CDK app with no code changes — the AWS SDK reads
`AWS_ENDPOINT_URL` from the environment natively; omitting it targets real AWS. Deploy is gated
behind manual approval in GitHub Actions (`campuspulse-production` environment).

**Status**: 43 unit tests pass (10 sensors, 26 fog, 7 backend), 6 integration tests prove the real
fog-security FSM, hvac-duct-pressure ingest, and Lambda handler code against floci's DynamoDB and
real API Gateway/SQS routing, `cdk synth`/`tsc` produce a
valid template, dashboard passes 18 Playwright tests (10 functional + 8 visual, across desktop and mobile
viewports). One bug found and
fixed during testing: the desktop "floor plan" tile layout used inline `grid-column`/`grid-row`
that fought the mobile column-count media query — fixed via CSS custom properties reset at the
640px breakpoint.

**Load test** (`load/results.md`): the ingest-only stack (`infra/bin/ingestOnlyTestApp.ts`) was
deployed to floci and load-tested by ramping 5 -> 40 concurrent virtual fog-node publishers
against the real SQS FIFO ingest queue (`SendMessage`, timed per call, queue depth read via real
`GetQueueAttributes` calls — see the results file for why SQS was targeted directly rather than
the HTTP edge). p95 latency held at 6.1ms at 5 concurrent publishers and 24.6ms at 40 (8x the
producers, ~4x the p95 — sub-linear degradation), with zero failed sends across 900 messages and
no messages dropped, confirming the queue decouples bursty concurrent ingestion from downstream
processing rather than blocking or rejecting producers under load.
