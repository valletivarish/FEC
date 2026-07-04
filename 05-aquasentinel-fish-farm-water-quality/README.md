# AquaSentinel — Fish-Farm Water-Quality Monitoring

A Python edge-to-cloud pipeline for a multi-pond fish farm. Ten sensors per pond feed three fog
nodes that triage water-quality risk locally — hypoxia, ammonia toxicity, overfeeding — and
dispatch only alerts and correlated readings into a scalable AWS backend with a live dashboard.

## Architecture

- **Sensors** (`sensors/`): 10 sensor metrics per pond (dissolved oxygen, water temperature, pH,
  salinity, turbidity, ammonia, nitrite, ORP, water level, feeder load), each independently
  configurable for sample and dispatch cadence via `sensors/config/pond-0N.yaml`, published over
  MQTT.
- **Fog nodes** (`fog/`): LifeSupportFog (temperature-compensated hypoxia staging with sensor-fault
  suppression), ToxicityFog (Emerson-equation un-ionised ammonia calculation with full provenance,
  plus an independent nitrite brown-blood-risk flag), OpsFog (multi-signal overfeeding inference).
  Dispatches to the backend over HTTP, with toxic/urgent alerts routed to a separate higher-priority
  path.
- **Backend** (`backend/` + `infra/`): API Gateway → two SQS queues (readings + a separate
  higher-priority alerts queue) → Lambda → DynamoDB. Scales via SQS load-leveling and Lambda
  concurrency.
- **Dashboard** (`dashboard/`): Bootstrap 5 — navbar, tables, cards, and semantic badges, themed
  with a muted teal-blue accent.

## Local development

From the repo root:

```
cp .env.example .env
make localstack-up
```

Then, from this folder:

```
python3 -m venv .venv && source .venv/bin/activate
pip install -r sensors/requirements.txt -r fog/requirements.txt -r backend/requirements.txt
cd infra && pip install -r requirements.txt && npx --yes aws-cdk@2 deploy --require-approval never && cd ..
MQTT_BROKER_URL=mqtt://localhost:1883 python -m sensors.main &
AQUASENTINEL_API_BASE_URL=<deployed-api-url> MQTT_BROKER_URL=mqtt://localhost:1883 python -m fog.main &
```

Dashboard:

```
cd dashboard && npm install && npm run serve
```

## Testing

```
source .venv/bin/activate
python -m pytest sensors fog backend -q
cd integration-test && \
  AWS_ENDPOINT_URL=http://localhost:4566 AWS_ACCESS_KEY_ID=test AWS_SECRET_ACCESS_KEY=test \
  AWS_REGION=eu-west-1 AWS_DEFAULT_REGION=eu-west-1 \
  AQUASENTINEL_READINGS_TABLE=AquaSentinelPondReadings AQUASENTINEL_ALERTS_TABLE=AquaSentinelPondAlerts \
  python -m pytest -v
cd dashboard && npm run test:e2e
```

## Deployment

Real AWS deployment uses the same CDK app with no code changes — the AWS SDK reads
`AWS_ENDPOINT_URL` from the environment natively; omitting it targets real AWS. Deploy is gated
behind manual approval in GitHub Actions (`aquasentinel-production` environment).

**Status**: 71 unit tests pass (10 sensors, 42 fog, 19 backend), 5 integration tests prove the real
LifeSupportFog/ToxicityFog/OpsFog logic and both Lambda handlers against floci's DynamoDB, `cdk
synth` produces a valid template, dashboard passes 22 Playwright tests (functional + visual, across
desktop and mobile viewports). A prior round fixed `/status` to genuinely merge urgent toxicity
from the alerts table; a follow-up adversarial re-check then found the dashboard's Hypoxia Watch
and Feed Correlation panels still read exclusively from `/alerts`, which the dispatcher never
routes life_support/ops_feed_correlation events to — those panels rendered their empty state in
real production regardless of sensor data. Fixed by sourcing both panels from the same `/status`
response already fetched for the rest of the dashboard; verified live against floci with real fog
logic, the real dispatcher's routing decision, and the real ingest/query Lambda handlers.

**Load test**: `cdk deploy` run fresh against floci, then `load/ramp_load_test.py` ramped 5 -> 10
-> 20 -> 40 concurrent simulated ponds (240 requests at peak) through the real deployed relay
Lambdas, SQS queues and ingest Lambdas. Readings-path p95 degraded steadily with concurrency
(407ms -> 623ms -> 1283ms -> 2323ms); the alerts path only pulled clearly ahead at peak load
(p95 34.6ms at 40 ponds, roughly 67x lower than readings), while at 5/10/20 ponds both paths'
p95s were within ~1.4x-2.4x of each other (floci Lambda cold-start noise). Zero messages
dead-lettered on either path at any level. DynamoDB persistence was independently re-verified this
session with a fresh full-table scan immediately after the run: 225 readings + 225 alerts items
stored, matching exactly what was sent. Full numbers, methodology, and a note on floci's
statefulness gap across container restarts (which explains why an earlier scan of these tables
found no data) are in [`load/results.md`](load/results.md). Same `cdk deploy` targets real AWS
ahead of submission with no code changes, per the Deployment section above.
