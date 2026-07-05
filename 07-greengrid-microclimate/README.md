# GreenGrid — Outdoor Campus Environmental & Microclimate Monitoring

A Python edge-to-cloud pipeline for outdoor campus weather stations. Ten sensors per station feed
three fog nodes that watch for storms, soil/plant risk, and pollution exceedances, dispatching
only the events that matter into a scalable AWS backend with a live dashboard.

## Architecture

- **Sensors** (`sensors/`): 10 sensor metrics per station (air temperature, soil moisture,
  rainfall, wind speed/direction, UV index, barometric pressure, PM2.5, ambient noise, leaf
  wetness), each independently configurable for sample and dispatch cadence via
  `sensors/config/station-*.yaml`, published over MQTT.
- **Fog nodes** (`fog/`): WeatherFog (wind vector-averaging that handles the 0/360° wraparound
  correctly, barometric slope, a weighted storm-risk score), SoilFog (irrigation/frost/disease
  risk rules, multiple can be active at once), PollutionFog (rolling p95 exceedance watch,
  computed from a disjoint historical baseline against the most recent readings — see the note
  below). Dispatches to the backend over HTTP.
- **Backend** (`backend/` + `infra/`): API Gateway → SQS → Lambda → DynamoDB. Scales via SQS
  load-leveling and Lambda concurrency.
- **Dashboard** (`dashboard/`): Bootstrap 5 — navbar, tables, cards, and semantic badges, themed
  with a warm khaki/olive-brown accent.

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
```

floci's community edition accepts the CDK deploy but doesn't route `execute-api` HTTP calls (control
plane only, no data plane — see `local_dev_shim.py`'s docstring). Locally, run the shim in place of
API Gateway; it forwards real HTTP requests to the real deployed Lambdas via `boto3 invoke`, so every
line of backend code still runs unchanged:

```
AWS_ENDPOINT_URL=http://localhost:4566 AWS_REGION=eu-west-1 python local_dev_shim.py &
```

This listens on `:3701` by default (override with `GREENGRID_SHIM_PORT`). Point both the fog
dispatcher and the dashboard at it — against real AWS, point `GREENGRID_API_BASE_URL` at the real
deployed API Gateway URL instead and skip the shim entirely:

```
MQTT_BROKER_URL=mqtt://localhost:1883 python -m sensors.main &
GREENGRID_API_BASE_URL=http://localhost:3701 MQTT_BROKER_URL=mqtt://localhost:1883 python -m fog.main &
```

Dashboard:

```
cd dashboard && npm install && npm run serve
```

`npm run serve` is a static file server (`http-server`), so it cannot inject an env var into the
page — the dashboard reads `window.GREENGRID_API_BASE_URL` (`dashboard/src/main.js`), falling back
to `http://localhost:3000` if unset. To point it at the shim, either run the browser console once
(`window.GREENGRID_API_BASE_URL = 'http://localhost:3701'; location.reload();`) or add a
`<script>window.GREENGRID_API_BASE_URL = 'http://localhost:3701';</script>` line to `index.html`
above the `main.js` import before serving.

## Testing

```
source .venv/bin/activate
python -m pytest sensors -q
python -m pytest fog -q
python -m pytest backend -q
```

Run each module separately, not combined as `pytest sensors fog backend`: each module has its own
bare top-level `main.py`, and Python's process-global `sys.modules` cache lets one module's file
silently shadow another's same-named module when collected in a single pytest run.

```
cd integration-test && \
  AWS_ENDPOINT_URL=http://localhost:4566 AWS_ACCESS_KEY_ID=test AWS_SECRET_ACCESS_KEY=test \
  AWS_REGION=eu-west-1 AWS_DEFAULT_REGION=eu-west-1 GREENGRID_READINGS_TABLE=GreenGridReadings \
  python -m pytest -v
cd dashboard && npm run test:e2e
```

## Deployment

Real AWS deployment uses the same CDK app with no code changes — the AWS SDK reads
`AWS_ENDPOINT_URL` from the environment natively; omitting it targets real AWS. Deploy is gated
behind manual approval in GitHub Actions (`greengrid-production` environment).

**Status**: 86 unit tests pass (18 sensors, 53 fog, 15 backend — run each module separately per the
note below), 5 integration tests prove the real
WeatherFog/SoilFog/PollutionFog logic and the Lambda handler against floci's DynamoDB, `cdk synth`
produces a valid template, dashboard passes 26 Playwright tests (13 functional + visual specs,
each run against both the `chromium-desktop` and `chromium-mobile` projects).

Two bugs found and fixed:

1. **A genuinely unreachable condition in PollutionFog.** The original exceedance-watch logic
   computed the rolling p95 from the same 20-sample window it then checked for exceedances against
   the most recent 10 — but the p95 interpolation formula (`index = 0.95*(n-1)`) always falls
   between the top two order statistics of whatever set it's computed from, so at most 1 sample
   can ever exceed its own window's p95. `EXCEEDANCE_THRESHOLD = 5` was mathematically
   unreachable; the feature was dead code that would never fire, confirmed empirically before
   fixing. Fixed by splitting the 20-sample window into a 10-sample historical baseline (p95
   computed from it) and the 10 most recent readings (checked against that baseline) — a
   disjoint split makes a genuine spike detectable.
2. Running `pytest sensors fog backend -q` as one combined invocation fails intermittently
   depending on collection order, because each module's bare top-level `main.py` collides in
   Python's shared module cache. Fixed by running each module's tests as a separate pytest
   invocation, in both CI and local dev instructions.

**Load test** (against floci, the local AWS emulator — see `load/results.md` for full
methodology, raw output, and reproduction commands): ramped simulated station traffic
from 10 to 80 req/s onto the real `greengrid-ingest-queue` → `greengrid-ingest-handler-fn`
(reserved concurrency 20, added to `infra/greengrid_stack.py` as part of this test —
previously unset) → `GreenGridReadings` pipeline. At 10 req/s, ingest-to-queryable p95
was 7.615s with peak queue depth 3; at 80 req/s, p95 rose to 53.467s with peak queue
depth 560 — zero messages lost at either level (640/640 processed at high load, queue
drained to empty afterwards). This confirms SQS genuinely load-levels an 8x burst
(buffering rather than dropping or erroring) and that reserved concurrency keeps the
Lambda's resource usage bounded; it does not by itself keep floci's local p95 flat under
load, because floci's own SQS-to-Lambda poller drains at a fixed ~10 msg/s independent of
reserved concurrency headroom — a documented emulator ceiling, not a code-path issue (see
results file). Real AWS deploy ahead of submission targets the same code path
unchanged, config-only endpoint swap, and is expected to scale pollers with reserved
concurrency rather than floci's fixed rate.
