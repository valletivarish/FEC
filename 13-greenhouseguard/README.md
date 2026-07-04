# GreenhouseGuard — Commercial Greenhouse Climate Control

A Node.js edge-to-cloud pipeline for 3 grow benches. Ten sensors feed three fog nodes that
derive a Vapour Pressure Deficit-based vent setpoint, track a Daily Light Integral shortfall,
watch fertigation (EC/pH) drift, and close the loop by cross-checking the reported vent position
against the setpoint the climate node itself just commanded — dispatching only classified events
into a scalable AWS backend with a live "bench-row" dashboard.

## Architecture

- **Sensors** (`sensors/`): 10 sensor metrics per zone (air-temperature, air-humidity, co2,
  par-light, substrate-moisture, substrate-ec, water-ph, water-temperature, vent-position,
  door-contact), each independently configurable for sample and dispatch cadence via per-zone
  JSON config, published over MQTT.
- **Fog nodes** (`fog/`): ClimateFogNode (Tetens-equation VPD, a derived vent-position setpoint
  published on a >5pp change or heartbeat, and a true trapezoidal-integration Daily Light
  Integral tracker with a once-per-day shortfall flag), FertigationFogNode (rolling-window OLS
  drift slope plus absolute-range breach classification for EC/pH, with a suggested dose
  direction; water-temperature gets its own out-of-band severity transition and flags EC readings
  with `temperatureCompensationNeeded` since EC probes' automatic temperature compensation is only
  reliable within a normal horticultural band), EnclosureFogNode (the closed-loop node — reasons
  over ClimateFogNode's own dispatched `setpoint_command` events, not raw sensor data, to detect a
  stalled or overshooting vent and an open door that defeats the climate loop). Dispatches to the
  backend over HTTP.
- **Backend** (`backend/` + `infra/`): API Gateway → SQS → Lambda → DynamoDB, split across a
  command-ledger table (setpoint history) and a faults table (everything else) so the "what did
  we command" and "what went wrong" stories don't share a table. A `relayIngestEvent` Lambda
  behind `POST /events` bridges the fog dispatcher's HTTP call onto the ingest queue's SQS API —
  it only forwards the raw body; `ingestEvent` still owns all parsing/routing. Scales via SQS
  load-leveling and Lambda concurrency.
- **Dashboard** (`dashboard/`): a horizontal bench-row layout — one full-width card per zone with
  a literal actual-vs-setpoint Bootstrap progress-bar gauge (the visual embodiment of the
  closed-loop story), distinct from every sibling project's card-grid/table/list-group archetypes.

## Local development

From the repo root:

```
cp .env.example .env
make localstack-up
```

Then, from this folder:

```
cd infra && npm install && npx --yes aws-cdk@2 deploy --require-approval never && cd ..
cd sensors && npm install && npm start &
cd fog && npm install && npm start &
```

Dashboard:

```
cd dashboard && npm install && npm run serve
```

## Testing

```
npm install && node_modules/.bin/eslint sensors fog backend integration-test dashboard load
cd sensors && npm install && npm test
cd fog && npm install && npm test
cd backend && npm install && npm test
cd integration-test && npm install && \
  AWS_ENDPOINT_URL=http://localhost:4566 AWS_ACCESS_KEY_ID=test AWS_SECRET_ACCESS_KEY=test \
  AWS_REGION=eu-west-1 AWS_DEFAULT_REGION=eu-west-1 \
  GREENHOUSEGUARD_COMMAND_LEDGER_TABLE=greenhouseguard-command-ledger-table \
  GREENHOUSEGUARD_FAULTS_TABLE=greenhouseguard-faults-table \
  npx jest
cd infra && npm install && npx tsc --noEmit && npx --yes aws-cdk@2 synth
cd dashboard && npm install && npm run test:e2e
```

## Deployment

Real AWS deployment uses the same CDK app with no code changes — the AWS SDK v3 default client
config reads `AWS_ENDPOINT_URL`/`AWS_REGION` from the environment natively; omitting them targets
real AWS. Deploy is gated behind manual approval in GitHub Actions
(`greenhouseguard-production` environment).

**Status**: ESLint (`eslint:recommended`, flat config shared across all 5 workspaces) passes clean
with no disabled rules. 80 unit tests pass (20 sensors, 51 fog, 9 backend), 6 integration tests prove the real
ClimateFogNode/FertigationFogNode/EnclosureFogNode logic — including the cross-node closed loop,
where a live `setpoint_command` from ClimateFogNode is handed to EnclosureFogNode in-process
exactly as the runtime wiring does, and a stalled vent is correctly detected, persisted, and
acknowledged — against floci's DynamoDB, plus one proving `relayIngestEvent` actually lands a
message on a real floci SQS queue (closing the gap where only in-process Lambda calls, never the
HTTP/API-Gateway/SQS path, had been exercised). `cdk synth` produces a valid template, dashboard
passes 14 Playwright tests (functional + visual, across desktop and mobile viewports), with the
populated-data visual snapshots inspected by hand before accepting them as baselines.

One generation-pipeline mistake caught and fixed before verification: the parallel build handed
back `fog/package.json` and `backend/package.json` as ROOT-level files (keyed as bare
`"package.json"` rather than `"fog/package.json"`/`"backend/package.json"`) — caught by
inspecting the returned file-path list before writing to disk (the established check for this
exact class of bug), along with their `test`/`main` script paths being written as if run from the
repo root (`jest fog/__tests__`) rather than from within their own module directory. Both fixed
by remapping the file path on write and correcting the scripts to `jest`/`index.js` relative to
each module's own folder. No fetch-binding or Playwright-version bugs this build — both were
pre-empted directly in the generation brief and verified correct on first read.

**Scalability**: the stack was deployed with `cdk deploy` against floci and load-tested by ramping
5 → 40 simulated zones (4 batched readings/faults each) through the real relay path onto the real
deployed `greenhouseguard-ingest-queue`, processed by `GreenhouseGuardIngestEventFunction` under
its real `reservedConcurrentExecutions: 20`. Across two back-to-back runs, relay-call p95 latency
grew sub-linearly from ~17ms at 5 zones to ~34ms at 40 zones (8x load → ~2x latency), zero of 600
events failed or landed in the DLQ, and the reserved-concurrency cap produced a small, consistently
self-clearing queue backlog (10 messages) only at the 40-zone level, never below it — full numbers,
JSON, and reproduction commands in [`load/results.md`](load/results.md). Full `cdk deploy` + load
test against real AWS still ahead of submission (this run was against floci).
