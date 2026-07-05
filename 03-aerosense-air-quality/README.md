# AeroSense — Indoor Air Quality & Ventilation Advisory

A Python edge-to-cloud pipeline for indoor air quality. Ten zone sensors feed three fog nodes that
suppress steady-state noise and dispatch only band changes, spikes, and rate-of-rise advisories
into a scalable AWS backend with a live "VentBoard" dashboard.

## Architecture

- **Sensors** (`sensors/`): 10 sensor topics per zone (CO2, PM2.5, PM10, TVOC, temperature,
  humidity, CO, NO2, HCHO, occupancy PIR), each independently configurable for sample frequency
  and dispatch rate via per-zone YAML profiles in `sensors/profiles/`, published over MQTT.
- **Fog nodes** (`fog/`): fog-particulate (5-sample rolling median + EPA band classification +
  spike detection), fog-gases (EWMA rate-of-rise with 2-consecutive-breach debounce + absolute
  limits), fog-comfort (occupancy-gated comfort index). Each dispatches advisories to the backend
  over HTTP.
- **Backend** (`backend/` + `infra/`): API Gateway (HTTP API) → SQS → Lambda → DynamoDB.
  Scales via SQS load-leveling and Lambda concurrency.
- **Dashboard** (`dashboard/`): "Stratus" — soft sky/cloud palette, radial AQI gauges, vanilla JS
  with no build step.

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
MQTT_BROKER_URL=mqtt://localhost:1883 python -m sensors.run_rig &
cd fog && MQTT_BROKER_URL=mqtt://localhost:1883 API_BASE_URL=<deployed-api-url> python run_fog.py &
```

Dashboard:

```
cd dashboard && npm install && npm run serve
```

## Testing

```
source .venv/bin/activate
ruff check .
python -m pytest sensors fog backend -q
AWS_ENDPOINT_URL=http://localhost:4566 AWS_ACCESS_KEY_ID=test AWS_SECRET_ACCESS_KEY=test \
  AWS_REGION=eu-west-1 AWS_DEFAULT_REGION=eu-west-1 AEROSENSE_ADVISORY_TABLE=AeroSenseAdvisoryEvents \
  python -m pytest integration-test -q
cd dashboard && npm run test:e2e
```

## Deployment

Real AWS deployment uses the same CDK app with no code changes — the AWS SDK reads
`AWS_ENDPOINT_URL` from the environment natively; omitting it targets real AWS. Deploy is gated
behind manual approval in GitHub Actions (`aerosense-production` environment).

**Status**: 58 unit tests pass (across sensors, fog, backend), 5 integration tests prove the real
fog-particulate/fog-gases logic and Lambda handler code against floci's DynamoDB, `cdk synth`
produces a valid template, dashboard passes 14 Playwright tests (7 functional + visual, across
desktop and mobile viewports).

Two bugs found and fixed during build-out:

1. The `infra` CDK stack originally shipped its own untested copy of the Lambda handlers under
   `infra/lambda_src/`, duplicating the already-tested `backend/functions/` code. Consolidated to
   a single source of truth — the stack now zips `backend/` directly and references dotted
   handler paths.
2. The visual-regression test for the radial AQI gauge used `page.setContent()` without first
   navigating to the dev server, so its root-relative module import silently failed to resolve
   and the gauge never rendered. Fixed by navigating to `/` before injecting the scripted markup.

`cdk deploy` against floci and a ramp load test (~10 → ~80 req/s) of the advisory-ingest path
were run and captured on 2026-07-03: p99 latency 822 ms at 10 req/s vs 8646 ms at 80 req/s, DLQ
depth held at 0 across all 750 requests sent, queue backlog (0 → 50) absorbed the burst and fully
drained after — full numbers, exact commands and an environment note (floci's HTTP API v2 data
plane isn't invokable locally, so the test calls the deployed intake Lambda directly, the same
handler code API Gateway proxies to) in [`load/results.md`](load/results.md). Real AWS run still
ahead of submission — same commands, only the endpoint/credentials change.
