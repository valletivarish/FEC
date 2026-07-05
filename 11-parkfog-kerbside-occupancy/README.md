# ParkFog — Kerbside Parking Occupancy & Dynamic Pricing

A Node.js edge-to-cloud pipeline for a 6-bay kerbside parking zone. Ten sensors feed three fog
nodes that fuse noisy occupancy signals, reconcile payment against dwell time, and watch kerb
conditions, dispatching only confirmed state changes into a scalable AWS backend with a live
dashboard.

## Architecture

- **Sensors** (`sensors/`): 10 sensor metrics (bay magnetometer, bay infrared, ANPR permit check,
  meter payment, EV charge state, disabled-bay badge scan, barrier entry count, kerb flood level,
  approach inbound count, camera free-space count), each independently configurable for sample and
  dispatch cadence via `sensors/config/zone-01.sensors.json`.
- **Fog nodes** (`fog/`): BaySensingFog (weighted magnetometer/infrared sensor-fusion vote with a
  3-reading hysteresis band, flags disabled-bay violations, and separately cross-validates the
  zone's camera free-space count against its own fused-available tally — a genuine reconciliation
  between two independent occupancy signals, debounced and skipped on heavily occluded frames,
  dispatching `camera_discrepancy_event` on a real multi-bay mismatch), AccessPaymentFog
  (reconciles purchased minutes against occupancy, ANPR-exempts genuine permit holders, tracks
  zone entry pressure as an EWMA over barrier-entry/approach-inbound counts), KerbConditionsFog
  (4-tier flood-band classification with debounced confirmation, folds a stuck EV charger fault
  into the same advisory). Dispatches to the backend over HTTP.
- **Backend** (`backend/` + `infra/`): API Gateway → SQS → Lambda → DynamoDB. Scales via SQS
  load-leveling and Lambda concurrency. A separate `computeZonePricing` Lambda runs on its own
  EventBridge schedule (every 2 minutes) rather than in the ingestion path, so pricing computation
  never blocks or slows event ingestion — see Dynamic Pricing below.
- **Dashboard** (`dashboard/`): plain SaaS-admin look — dark sidebar, white content, one plum
  accent color — with a card-tile grid for the 6 bays (the literal "which spaces are free" view a
  parking dashboard exists to answer), card-wrapped tables below for overstay/pressure, kerb
  conditions, a hysteresis/change-detection debounce trace panel, and the full event log.

## Dynamic pricing

`computeZonePricing` (`backend/functions/computeZonePricing/`) is decoupled onto its own
EventBridge schedule (`rate(2 minutes)`) so it never competes with the SQS-driven ingestion path.
Each run reads the zone's most recent `zone_pressure_event` — the EWMA entry-pressure signal
AccessPaymentFog already dispatches from real barrier-entry/approach-inbound counts (alpha 0.3) —
and derives a tariff:

```
tariff = clamp(baseTariff + demandRate * (entryPressureEwma - neutralEwma), minTariff, maxTariff)
```

with `baseTariff = £2.00`, `neutralEwma = 5` (roughly the low end of typical combined
barrier/approach demand), `demandRate = £0.10` per EWMA unit above that baseline, clamped to a
`£1.00`–`£6.00` band. It's a deliberately simple linear formula — a base rate plus a bounded
demand adjustment — appropriate for a single-zone MVP rather than a market-clearing pricing model.

The Lambda reads the zone's last dispatched `tariff_changed` event (same table, same query
pattern as every other reader) to know the current price, and only writes a new `tariff_changed`
event when the computed tariff has genuinely moved by more than a rounding threshold — a stable
demand signal never spams repeat events. Event shape:
`{ type: 'tariff_changed', entityId, previousTariff, newTariff, demandSignal, timestamp }`, stored
in the same single-table design as every other event type, so it flows through
`queryZoneStatus`/the dashboard with no API changes. The dashboard's Debounce Trace panel and
Event Log both render it (`£2.00→£3.20 [demand-triggered, 1/1 confirmed]`).

## Local development

From the repo root:

```
cp .env.example .env
make localstack-up
```

Then, from this folder:

```
cd infra && npm install && npx --yes aws-cdk@2 deploy --require-approval never && cd ..
```

The deploy prints a `ParkFogApiUrl` output — export it (and the sensor rig's broker URL) before
starting the sensor and fog processes, since neither has a usable default for these:

```
export MQTT_BROKER_URL=mqtt://localhost:1883
export PARKFOG_API_BASE_URL=<ParkFogApiUrl from the cdk deploy output, no trailing slash>
cd sensors && npm install && npm start &
cd fog && npm install && npm start &
```

Dashboard:

```
cd dashboard && npm install && npm run serve
```

## Testing

```
cd sensors && npm install && npm test
cd fog && npm install && npm test
cd backend && npm install && npm test
cd integration-test && npm install && \
  AWS_ENDPOINT_URL=http://localhost:4566 AWS_ACCESS_KEY_ID=test AWS_SECRET_ACCESS_KEY=test \
  AWS_REGION=eu-west-1 AWS_DEFAULT_REGION=eu-west-1 PARKFOG_EVENTS_TABLE=parkfog-events-table \
  npx jest
cd infra && npm install && npx tsc --noEmit && npx --yes aws-cdk@2 synth
cd dashboard && npm install && npm run test:e2e
```

Lint (ESLint flat config, shared `eslint.config.js` at this project's root, `eslint:recommended`):

```
cd sensors && npm install && npm run lint
cd fog && npm install && npm run lint
cd backend && npm install && npm run lint
cd integration-test && npm install && npm run lint
cd dashboard && npm install && npm run lint
```

## Load testing

```
cd infra && npm install && \
  AWS_ENDPOINT_URL=http://localhost:4566 AWS_REGION=eu-west-1 \
  AWS_ACCESS_KEY_ID=test AWS_SECRET_ACCESS_KEY=test \
  CDK_DEFAULT_ACCOUNT=000000000000 CDK_DEFAULT_REGION=eu-west-1 \
  npx --yes aws-cdk@2 deploy --require-approval never
cd ../load && npm install && node run.js
```

Drives the deployed `ingestBayEvents` Lambda directly at ramping req/s and flips its reserved
concurrency between two configs mid-run; see [`load/results.md`](load/results.md) for the method
and real numbers.

## Deployment

Real AWS deployment uses the same CDK app with no code changes — the AWS SDK v3 default client
config reads `AWS_ENDPOINT_URL`/`AWS_REGION` from the environment natively; omitting them targets
real AWS. Deploy is gated behind manual approval in GitHub Actions (`parkfog-production`
environment).

**Status**: 98 unit tests pass (22 sensors, 51 fog — including the BaySensingFog camera/fused-vote
reconciliation — 25 backend, including the `computeZonePricing` demand→tariff formula and
change-detection logic), 6 integration tests prove the real
BaySensingFog/AccessPaymentFog/KerbConditionsFog logic and the `ingestBayEvents` Lambda handler
against floci's DynamoDB, `cdk synth` produces a valid template, dashboard passes 18 Playwright
tests (functional + visual, across desktop and mobile viewports). `computeZonePricing` was also
manually verified end-to-end against a real floci DynamoDB table outside the mocked unit tests: a
seeded `zone_pressure_event` produced a genuine first `tariff_changed` write, a repeat invocation
with unchanged demand correctly wrote nothing, and a sharp demand drop produced a second genuine
`tariff_changed` event reading the real previous price back from DynamoDB.

One bug found and fixed: `ParkfogApiClient`'s constructor defaulted `fetchImpl` to a bare `fetch`
reference (`fetchImpl = fetch`). Calling it as `this.fetchImpl(url)` invokes native `fetch` with
`this` bound to the client instance instead of `window`, which real Chromium rejects with
`Illegal invocation` whenever `fetch` is intercepted or monkey-patched — exactly what Playwright's
`page.route` does. The dashboard's `try/catch` silently swallowed the failure and fell back to the
empty state, which is why every "populated data" visual/functional test kept rendering as if the
backend had returned nothing despite a correctly-shaped mock. Fixed by defaulting to
`fetch.bind(globalThis)` instead. Caught by systematic isolation (route interception, minimal
in-page repros) after the dashboard's own weak assertion (`.toHaveCount(6)` on bay tiles, which
passed whether tiles held real data or placeholder `UNKNOWN`s) failed to catch it — visual snapshot
inspection is what actually surfaced the bug.

**Scalability mechanism — load-tested**: reserved concurrency on `parkfog-ingest-bay-events`
(the SQS-triggered ingest Lambda) was deployed to floci and load-tested with a real before/after
comparison at `ReservedConcurrentExecutions` 5 vs 20, ramping 10→80 req/s of direct Lambda
invocations against each. At 5, the first (cold-start) burst hit real `TooManyRequestsException`
throttling on 12 of 15 requests, with a worst-case p95 of 5993 ms; at 20, the identical burst
produced zero throttling and a worst-case p95 of 15 ms across the whole ramp. Full method, raw
numbers, and reproduction commands: [`load/results.md`](load/results.md). Fixed one real bug
surfaced by the attempt: the CDK asset for `ingestBayEvents`/`queryZoneStatus`/`healthCheck` only
packaged each function's own folder, not the sibling `backend/lib/` it requires, so every
real invocation failed with `Runtime.ImportModuleError` — this would have broken identically on
real AWS, not just floci.
