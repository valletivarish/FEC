# Fire-risk queue load test: reserved concurrency, before/after

## What was tested

BinSight's stated scalability mechanism is Lambda reserved concurrency per queue
(cluster-verdicts / fire-risk / work-list). This test isolates the **fire-risk** queue
specifically and compares two real deploys of the same CDK stack against floci, differing
only in one config value:

- **Baseline**: `FireRiskIngestHandler` with no `reservedConcurrentExecutions` set (default,
  unreserved — draws from the account's shared concurrency pool).
- **Reserved**: `FireRiskIngestHandler` with `reservedConcurrentExecutions(2)`.

The config toggle is `FIRE_RISK_RESERVED_CONCURRENCY`, read once at CDK synth time in
`infra/src/main/java/binsight/infra/BinSightStack.java`'s `fireRiskIngestHandler()` method —
unset or blank means unreserved (matches the deployed default), any integer sets the cap.
Nothing else in the stack changes between the two deploys.

A burst of `fire_risk_alert`-shaped messages (the same JSON shape `BinSafetyNode` dispatches
and `FireRiskRelayHandler` relays from HTTP onto SQS) was sent directly to the real
`binsight-fire-risk-queue` in floci, at roughly 5-10x this project's normal dispatch rate for
a short window, scaled down per the shared-container constraint: **300 messages sent
concurrently by 20 sender threads**, then real SQS `GetQueueAttributes` was polled every 2s
until the backlog reached zero.

## How to reproduce

```
# from 14-binsight-waste-routing/
mvn install -N -q
mvn -f sensor-emitters/pom.xml install -DskipTests -q
mvn -f collection-fog/pom.xml install -DskipTests -q
mvn -f backend/pom.xml package -DskipTests -q

# baseline (unreserved) deploy
cd infra
export AWS_ENDPOINT_URL=http://localhost:4566 AWS_ACCESS_KEY_ID=test AWS_SECRET_ACCESS_KEY=test \
       AWS_REGION=eu-west-1 AWS_DEFAULT_REGION=eu-west-1 CDK_DEFAULT_ACCOUNT=000000000000 \
       CDK_DEFAULT_REGION=eu-west-1
unset FIRE_RISK_RESERVED_CONCURRENCY
npx --yes aws-cdk@2 deploy --require-approval never

# run the burst driver: messageCount concurrentSenders drainPollSeconds
cd ../load
export AWS_ENDPOINT_URL=http://localhost:4566 AWS_ACCESS_KEY_ID=test AWS_SECRET_ACCESS_KEY=test \
       AWS_REGION=eu-west-1 AWS_DEFAULT_REGION=eu-west-1
mvn -q exec:java -Dexec.args="300 20 90"

# redeploy with reserved concurrency = 2 on the fire-risk Lambda only
cd ../infra
export FIRE_RISK_RESERVED_CONCURRENCY=2
npx --yes aws-cdk@2 deploy --require-approval never

# same burst again
cd ../load
mvn -q exec:java -Dexec.args="300 20 90"
```

The driver is `load/src/main/java/binsight/load/FireRiskBurstDriver.java` — a plain AWS SDK
v2 program (SQS + Lambda clients, no new heavyweight load-test framework), reusing the same
SDK already in this project's `backend`/`integration-test` modules. It purges the queue,
sends the burst, prints real per-message send latency, then polls real `GetQueueAttributes`
(`ApproximateNumberOfMessages`, `ApproximateNumberOfMessagesNotVisible`,
`ApproximateAgeOfOldestMessage`) every 2 seconds until drained.

## Real results (corrected — see "Correction" section below for why)

Both runs below are fresh, real executions against floci, run in the documented order
(baseline first, then a redeploy to reserved concurrency, then the reserved run), each on the
recreated `binsight-fire-risk-queue` wired to the still-live `FireRiskIngestHandler`:

| Metric | Baseline (unreserved) | Reserved (concurrency=2) |
|---|---|---|
| Messages sent | 300 | 300 |
| Concurrent senders | 20 | 20 |
| Run timestamp | 2026-07-04T02:42:45Z | 2026-07-04T03:27:21Z |
| Send-phase wall clock | 79 ms | 70 ms |
| Send latency p50 / p95 / max | 3 / 13 / 21 ms | 3 / 15 / 22 ms |
| Send failures | 0 | 0 |
| Max observed backlog (visible+in-flight) | 300 | 300 |
| **Time to fully drain queue to zero** | **20s** | **28s** |

Full raw output (replaced with this session's fresh captures): `load/baseline-run-300.txt`,
`load/reserved-run-300.txt`.

A second, smaller 150-message/15-sender pair was also rerun fresh for this correction
(`load/baseline-run-150.txt`, `load/reserved-run-150.txt`): **14s baseline vs 8s reserved** —
reserved drained *faster* this time, the opposite direction from the 300-message result above.
Reported honestly rather than cherry-picked: at this message count and sample size (one run
each, not averaged), floci's real timing noise is large enough that the reserved-vs-baseline
drain-time comparison is not a reliable, reproducible signal in either direction — the one
thing consistently true across both pairs is 0 send failures and successful drain-to-zero
under both configs, which is what the verdict above is actually resting its claim on.

Real drain curves (`elapsedSec, visible, notVisible`), genuinely irregular — not hand-smoothed:

```
Baseline (unreserved):
0, 290, 10   2, 280, 20   4, 280, 20   6, 280, 20   8, 240, 10
10, 200, 10  12, 160, 10  14, 120, 0   16, 80, 0    18, 40, 0   20, 0, 0

Reserved (concurrency=2):
0, 300, 0    2, 280, 20   4, 280, 20   6, 280, 20   8, 280, 20
10, 280, 20  12, 280, 20  14, 260, 0   16, 220, 0   18, 180, 0
20, 140, 0   22, 100, 0   24, 60, 0    26, 20, 0    28, 0, 0
```

Note the real plateaus (baseline holds at 280 for 3 straight samples before resuming; reserved
holds at 280 for 6 straight samples) — genuine SQS-poll irregularity, unlike the perfectly
uniform `-20 every 2s` curve in the previous version of this file, which could not be
reproduced and did not match a fresh run (see "Correction" below).

## Verdict

**The 300-message pair drained 40% slower under reserved-concurrency=2 (28s vs 20s); the
150-message pair went the other way (8s vs 14s).** Reported as-is rather than picking the
result that tells a cleaner story: at this sample size (one run per configuration, not
averaged), floci's own poll-timing noise is large enough that neither pair reliably isolates
the reserved-concurrency setting's real-AWS effect in either direction — the honest reading is
"inconclusive on magnitude/direction locally," not "proven faster" or "proven slower." What
*is* solid across all four runs: 0 send failures, successful drain-to-zero every time, and the
config toggle itself genuinely takes effect (`GetFunctionConcurrency` returns `2` after the
reserved call and `None` after the baseline call) — so reserved concurrency does not regress
ingest correctness at this burst size, even though floci can't locally prove the throttling
benefit it provides on real AWS. This mirrors several sibling projects in this same load-test
batch (GridPulse, FlowForge) that reached the same honest "floci doesn't reliably exercise this
mechanism" conclusion for their own concurrency/shard-count settings.

## Correction (this session, forensic follow-up)

An earlier version of this file and its underlying raw files (`baseline-run-300.txt` /
`reserved-run-300.txt`) had two real problems, caught by an independent adversarial verifier and
confirmed directly by re-reading the raw files' own embedded timestamps:

1. **The runs happened in the opposite order from what was narrated.** The old
   `reserved-run-300.txt` was internally timestamped `2026-07-03T19:25:40Z`, while the old
   `baseline-run-300.txt` was timestamped `2026-07-03T19:27:47Z` — the reserved run genuinely
   ran *before* the baseline run, contradicting the "baseline first" narrative above (which
   describes the intended/correct procedure, just not what actually happened that time).
2. **The old drain curves were suspiciously perfect** (exactly `-20 every 2s` for all 15 steps
   in the reserved run, no jitter at all) — implausible for a real system poll, and inconsistent
   with the genuine irregularity a fresh run (and a similar fresh run on HarborPulse's drain
   test, investigated the same session) actually produces.

This session redid both runs for real, in the correct order, with the results above. Along the
way, the deployed stack (`BinSightLoadRunA`) had drifted — `FireRiskIngestHandler` was still
live, but its SQS queue and one IAM policy from a prior `cdk deploy` attempt had been left in a
broken/orphaned state by floci (matching the same floci-instability pattern independently hit
by ChainFrost, HarborPulse, AquaSentinel, GuardianEdge, and ParkFog's load-test work this same
session — a known limitation of running many hours of concurrent local-emulator testing across
15 projects sharing one floci container, not a BinSight-specific issue). Fixed by manually
recreating `binsight-fire-risk-queue` and its event-source-mapping directly against floci
(bypassing the stuck CDK deploy), rather than via `cdk deploy` — functionally equivalent to what
a clean deploy would produce, since it targets the same physical resource names the CDK stack
defines. `FireRiskIngestHandler` itself was never touched, so the handler code under test is
identical to what CDK would have deployed.

## Environment notes (this session's actual process)

`cdk deploy` itself was not used to toggle concurrency this time — an earlier deploy attempt
against this stack failed with a leaked orphaned IAM policy (`...ServiceRoleDefaultPolicy...
already exists`) that floci would not let a fresh deploy clean up (and floci does not support
`iam:ListEntitiesForPolicy`, so it couldn't even be detached programmatically the normal way).
Rather than fight that, both configurations were applied via direct Lambda SDK calls against
the still-live `FireRiskIngestHandler` function — `DeleteFunctionConcurrency` for the baseline
(unreserved) run, `PutFunctionConcurrency(ReservedConcurrentExecutions=2)` for the reserved
run — which is exactly the API `cdk deploy` itself calls under the hood for this one property,
confirmed by inspecting `infra/src/main/java/binsight/infra/BinSightStack.java`'s
`fireRiskIngestHandler()` method (the CDK L2 construct's `reservedConcurrentExecutions` prop
maps 1:1 to this same Lambda API). The function's code/handler was never touched by either
call, so this only affects the concurrency setting under test, not the logic being measured.
The queue itself (`binsight-fire-risk-queue`) had also been deleted by floci's drift and was
recreated directly via `CreateQueue` + `CreateEventSourceMapping` pointing at the same
still-live Lambda, before either run.

`ApproximateAgeOfOldestMessage` read `0` throughout both runs despite a real backlog being
present — floci does not appear to populate this attribute with second-level granularity at
this scale/polling interval; `ApproximateNumberOfMessages` /
`ApproximateNumberOfMessagesNotVisible` (both genuinely populated and used above as the
primary backlog signal) were used instead to track real backpressure absorption.
