# OfficeIQ — Smart-Office Occupancy & Comfort

A Node.js edge-to-cloud pipeline for office-floor comfort and occupancy. Ten sensors per zone feed
three fog nodes that reconcile occupancy signals, watch ventilation/pressure comfort, and flag
wasted energy, dispatching to a backend whose ingestion path scales via **ECS Fargate container
autoscaling** — the one project in this portfolio that demonstrates a literal, inspectable replica
count under load, rather than Lambda concurrency.

## Architecture

- **Sensors** (`sensors/`): 10 sensor metrics per zone (desk occupancy, CO2, temperature,
  humidity, light, people-counter, plug power, window state, pressure differential, meeting-room
  noise), each independently configurable for sample and dispatch cadence via
  `sensors/config/zone-*.sensors.json`, published over MQTT.
- **Fog nodes** (`fog/`): OccupancyFog (reconciles desk-occupancy vs people-counter, biases the
  resolved headcount toward the people-counter after 3 consecutive same-direction discrepancies),
  ComfortFog (a 4-condition VENTILATION_ANOMALY gate plus an independent PRESSURE_FAULT check,
  both transition-gated), UsageFog (idle-with-load streak detection with an escalating
  DEVICE_LEFT_ON / DEVICE_LEFT_ON_ESCALATED pair). Dispatches to the backend over HTTP.
- **Backend** (`backend/` + `infra/`): SQS → **ECS Fargate worker** (long-polling container,
  Application Auto Scaling step-scaling on queue depth, min 1 / max 8 tasks) for ingestion, plus 2
  read-side Lambda handlers for dashboard queries. DynamoDB for storage.
- **Dashboard** (`dashboard/`): Bootstrap 5 — navbar, tables, cards, and semantic badges, themed
  with a muted slate-blue accent, including a literal running/desired task-count scaling status
  card.

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
OFFICEIQ_API_BASE_URL=<deployed-api-url> OFFICEIQ_MQTT_URL=mqtt://localhost:1883 node fog/index.js &
```

The worker itself (`backend/worker/ingestWorker.js`) runs as a plain Node process locally (same
code as the Fargate container, just not containerized) — `node backend/worker/ingestWorker.js`
with `OFFICEIQ_EVENT_QUEUE_URL` and `OFFICEIQ_READINGS_TABLE` set.

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
  AWS_REGION=eu-west-1 AWS_DEFAULT_REGION=eu-west-1 OFFICEIQ_READINGS_TABLE=OfficeIQReadings \
  npx jest
cd dashboard && npm run test:e2e
```

## Deployment

Real AWS deployment uses the same CDK app with no code changes — the AWS SDK reads
`AWS_ENDPOINT_URL` from the environment natively; omitting it targets real AWS. Deploy is gated
behind manual approval in GitHub Actions (`officeiq-production` environment).

**Status**: 105 unit tests pass (37 sensors, 50 fog, 18 backend), 5 integration tests prove the real
OccupancyFog/ComfortFog/UsageFog logic and the worker's `processMessage` write path against
floci's DynamoDB, plus the `POST /events` relay Lambda landing a message on floci's real SQS event
queue, `cdk synth`/`tsc` produce a valid template including the ECS cluster, Fargate task/service,
step-scaling policies, and the API Gateway route -> relay Lambda -> SQS ingest path, dashboard
passes 24 Playwright tests (functional + visual, across desktop and mobile viewports).

**Scalability measurement**: the stack was deployed to floci and load-tested end to end. floci's
Application Auto Scaling control plane turned out not to genuinely evaluate/trigger scaling
actions (`DescribeScalableTargets` returns `UnknownOperationException` even though the AAS CFN
resources deploy correctly), so the measurement drives the real `OfficeIqWorkerService` at
`desiredCount=1` vs `desiredCount=8` (this stack's `maxCapacity`) directly and compares real
consumer-side drain rate for the same 200-message burst: **5.86 msg/s at 1 task vs 49.89 msg/s at
8 tasks (8.5x), both fully drained with zero failures**, measured via genuine `ECS
DescribeServices` and `SQS GetQueueAttributes` calls. Full method, real per-sample data, and the
floci-specific deployment workarounds required (plus two genuine pre-existing bugs the exercise
surfaced and fixed) are in [`load/results.md`](load/results.md).
