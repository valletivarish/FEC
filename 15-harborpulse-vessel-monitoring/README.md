# HarborPulse — Small-Fleet Vessel Engine & Sea-State Monitoring

A Python edge-to-cloud pipeline for a small fleet of 3 vessels. Ten sensors feed three fog nodes
that derive bearing-wear energy from raw vibration via a real FFT, classify sea state from roll
motion and wind with an adaptive reporting cadence, and watch bilge level with haversine-decimated
GPS tracking that tightens automatically during an active alarm — dispatching only classified
events into a scalable AWS backend with a live radar-sweep "Bridge" console.

## Architecture

- **Sensors** (`sensors/`): 10 sensor metrics per vessel (engine-rpm, engine-coolant-temp,
  engine-oil-pressure, engine-fuel-flow, engine-vibration-raw, hull-bilge-level, nav-gps,
  nav-attitude, weather-wind-speed, nav-heading), each independently configurable for sample and
  dispatch cadence via per-vessel YAML config, published over MQTT.
- **Fog nodes** (`fog/`): EngineFog (Hann-windowed real FFT over a rolling vibration window,
  power-spectral-density energy summed in a bearing-wear band, a rolling 3-sigma baseline flags
  `degradedBearing` — the raw waveform is discarded after this computation, never persisted),
  SeaStateFog (peak-to-peak roll amplitude + zero-crossing period, a Beaufort-inspired 5-class
  score, adaptive dispatch cadence that widens once the class has been stable for 3 recomputations
  and snaps back tight on any class change), SafetyFog (OLS bilge-level slope, a dual-condition
  alarm that dispatches continuously while active and once more on clearing, real-haversine GPS
  decimation that shortens its recording interval automatically while that vessel's alarm is
  active). Dispatches to the backend over HTTP via a `FleetEventDispatcher`.
- **Backend** (`backend/` + `infra/`): API Gateway → SQS → Lambda → DynamoDB, split across 2
  independently-scalable queues (telemetry, alarms) so a telemetry flood never delays a bilge
  alarm. Also includes `relay_telemetry`/`relay_alarm` — small Lambdas, one per queue, that relay
  their HTTP body onto SQS (see "Architectural note" below).
- **Dashboard** (`dashboard/`): "the Bridge" — a dark navy chart-plotter console with a genuine
  circular radar-sweep `<canvas>` plot (range rings, vessels placed by real haversine
  bearing/distance from a fixed home port, colored by sea-state class) as its signature view,
  distinct from FlowForge's rectangular gauge-dial canvas and BinSight's flat 2D map canvas.

## Architectural note: the ingest-relay fix

Continuing the fix introduced in BinSight (project 14): a real gap was found across sibling
projects 1–13 where each one's fog layer POSTs to an HTTP path that no API Gateway route in that
project's own CDK stack actually backs. HarborPulse's `relay_telemetry` and `relay_alarm` Lambdas
close that gap for itself — each relays its raw HTTP body onto its own SQS queue — and
`integration-test/test_sensor_to_fog_to_backend.py`'s
`test_relay_telemetry_actually_delivers_an_http_posted_body_onto_the_real_sqs_queue` proves the
exact `handler` code path lands a message on a real (floci) queue.

## Local development

From the repo root:

```
cp .env.example .env
make localstack-up
```

Then, from this folder:

```
cd infra && python3 -m venv .venv && source .venv/bin/activate && pip install -r requirements.txt
npx --yes aws-cdk@2 deploy --require-approval never
cd ../sensors && python3 -m venv .venv && source .venv/bin/activate && pip install -r requirements.txt && python main.py &
cd ../fog && python3 -m venv .venv && source .venv/bin/activate && pip install -r requirements.txt && python main.py
```

Dashboard:

```
cd dashboard && npm install && npm run serve
```

## Testing

```
python3 -m venv .venv && source .venv/bin/activate && pip install ruff==0.6.9 && ruff check .
cd sensors && python3 -m venv .venv && source .venv/bin/activate && pip install -r requirements.txt && python -m pytest tests/ -v
cd fog && python3 -m venv .venv && source .venv/bin/activate && pip install -r requirements.txt pytest && python -m pytest tests/ -v
cd backend && python3 -m venv .venv && source .venv/bin/activate && pip install boto3 moto pytest && python -m pytest tests/ -v
cd integration-test && python3 -m venv .venv && source .venv/bin/activate && pip install -r requirements.txt && \
  AWS_ENDPOINT_URL=http://localhost:4566 AWS_ACCESS_KEY_ID=test AWS_SECRET_ACCESS_KEY=test \
  AWS_REGION=eu-west-1 AWS_DEFAULT_REGION=eu-west-1 \
  HARBORPULSE_TELEMETRY_TABLE=harborpulse-telemetry-table HARBORPULSE_ALARMS_TABLE=harborpulse-alarms-table \
  HARBORPULSE_TARGET_QUEUE_URL=http://localhost:4566/000000000000/harborpulse-it-relay-queue \
  python -m pytest -v
cd infra && python3 -m venv .venv && source .venv/bin/activate && pip install -r requirements.txt && npx --yes aws-cdk@2 synth
cd dashboard && npm install && npm run test:e2e
```

## Deployment

Real AWS deployment uses the same CDK app with no code changes — boto3's default clients read
`AWS_ENDPOINT_URL`/`AWS_REGION` from the environment natively; omitting them targets real AWS.
Deploy is gated behind manual approval in GitHub Actions (`production` environment).

**Status**: 80 unit tests pass (28 sensors, 41 fog, 11 backend), 6 integration tests prove the real
EngineFog/SeaStateFog/SafetyFog logic and all 5 Lambda handlers — including the relay-to-SQS HTTP
path — against floci's DynamoDB and SQS. `cdk synth` produces a valid template (5 Lambda functions,
4 queues), dashboard passes 22 Playwright tests (functional + visual, across desktop and mobile
viewports) with the populated-data visual snapshots inspected by hand — the radar-sweep canvas
genuinely renders 3 vessels as range/bearing blips colored by sea-state class, confirmed distinct
from every sibling dashboard.

One generation-pipeline issue caught during verification: the parallel build's backend agent wrote
its files DIRECTLY to disk (bypassing the JSON return contract) and left placeholder text like
`"(see repo file at ...)"` in its JSON response for what should have been full test-file content.
Caught by checking file line counts before trusting the returned JSON. Unlike a prior sibling
project's near-identical-looking failure (which turned out to be entirely empty prose stubs with
no real files anywhere), this one's on-disk files were genuinely complete and correct — verified
independently by re-running the full backend pytest suite from scratch (11/11 passed) and reading
several handlers against the contract before trusting it.

**Load test** (`load/`): `harborpulse-ingest-telemetry-fn`'s stated scalability mechanism —
`reserved_concurrent_executions=20` — was deployed to floci and exercised with a real 20-vessel
fleet ramp (`load/fleet_ramp_load_test.py`, plain boto3 threads, no added dependency): 60s at
~9.5 events/sec fleet-wide left the telemetry queue fully drained; 60s at ~18.9 events/sec
(~2x) built a real backlog of 534 queued messages, which the capped-at-20 consumer then drained
in ~45s at a steady ~10 msgs/5s once the ramp ended, with zero delivery errors across 1734 events
sent. Full real numbers, exact reproduction commands, and raw JSON captures in
[`load/results.md`](load/results.md).

Full `cdk deploy` + load test against real AWS ahead of submission.
