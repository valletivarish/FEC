# GreengrassGuard — Predictive Maintenance via Vibration Analysis

A Python edge-to-cloud pipeline for rotating industrial equipment. Ten sensors per asset feed
three fog nodes that keep raw vibration waveforms entirely on-edge and dispatch only compact,
triaged diagnosis verdicts into a scalable AWS backend with a live dashboard.

## Architecture

- **Sensors** (`sensors/`): 10 sensor metrics per asset (axial/radial vibration, acoustic
  emission, winding/bearing temperature, current, RPM, hydraulic pressure/flow, humidity), each
  independently configurable for sample and dispatch cadence via `sensors/config/asset-0N.yaml`,
  published over MQTT. Vibration readings additionally carry a 32-sample raw waveform window so
  the fog layer has something real to analyze.
- **Fog nodes** (`fog/`): VibeCore (Hann-windowed FFT into 3 frequency bands, EWMA baseline,
  2-consecutive-breach fault gate — never forwards raw waveform data, only band verdicts — plus an
  acoustic-emission dB threshold that raises an independent low-severity advisory and, when it
  coincides with a vibe fault, escalates that fault's severity as a corroborating signal),
  ThermalGuard (rolling-slope runaway detection plus a current/RPM sideband deviation check, each
  independently debounced), HydraulicFog (efficiency proxy plus a dual-condition cavitation check,
  where high ambient humidity relaxes the pressure ratio that trips cavitation since moisture
  ingress promotes it physically). Dispatches diagnosis events to the backend over HTTP.
- **Backend** (`backend/` + `infra/`): API Gateway → SQS → Lambda → DynamoDB. Scales via SQS
  load-leveling and Lambda concurrency.
- **Dashboard** (`dashboard/`): Bootstrap 5 — navbar, tables, cards, and semantic badges, themed
  with an industrial-orange accent on a dark workshop-style sidebar.

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
GUARD_API_BASE_URL=<deployed-api-url> MQTT_BROKER_URL=mqtt://localhost:1883 python -m fog.main &
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
  AWS_REGION=eu-west-1 AWS_DEFAULT_REGION=eu-west-1 GUARD_DIAGNOSIS_TABLE=GuardDiagnosisEvents \
  python -m pytest -v
cd dashboard && npm run test:e2e
```

## Deployment

Real AWS deployment uses the same CDK app with no code changes — the AWS SDK reads
`AWS_ENDPOINT_URL` from the environment natively; omitting it targets real AWS. Deploy is gated
behind manual approval in GitHub Actions (`greengrassguard-production` environment).

**Status**: 91 unit tests pass (across sensors, fog, backend), 5 integration tests prove the real
VibeCore/ThermalGuard/HydraulicFog logic and the Lambda handler against floci's DynamoDB, `cdk
synth` produces a valid template, dashboard passes 22 Playwright tests (functional + visual,
across desktop and mobile viewports).

One bug found and fixed: `sensors/requirements.txt` and `fog/requirements.txt` pinned conflicting
exact versions of PyYAML and pytest, which broke installing both into one environment — fog never
actually used PyYAML at all, so it was removed there and pytest relaxed to a range.

**Load test**: `cdk deploy` run fresh against floci, then `load/fault_storm_test.py` simulated 20
assets each firing a `vibe_fault` roughly every 150ms for 60 seconds (a sustained storm, not a
spike) through the real deployed relay Lambda, SQS intake queue and batch-of-10 intake Lambda.
Queue backlog depth (sampled every second, since floci doesn't expose
`ApproximateAgeOfOldestMessage`) peaked at 14 messages and self-drained back to 0 essentially
every cycle — 77% of samples read empty — with `ApproximateNumberOfMessagesNotVisible` staying at
0 throughout, meaning the single consumer container never fell behind a batch. All 140 relayed
diagnoses returned `202 Accepted`, `messages_stored` increased by exactly 140, and the DLQ stayed
at 0 — no diagnosis lost despite the burst. Full numbers, the exact reproduce commands, and an
environment note (floci's HTTP API v2 data plane isn't invokable locally, so the test calls the
deployed relay Lambda directly, the same handler code API Gateway proxies to; floci is also a
shared, memory-constrained host that inflates absolute per-invoke latency under concurrent
multi-project load, documented via `docker ps` at the time of the run) are in
[`load/results.md`](load/results.md). Same `cdk deploy` targets real AWS ahead of submission with
no code changes, per the Deployment section above.
