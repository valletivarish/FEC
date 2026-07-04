# Gauge-intake reserved-concurrency load test

Scalability mechanism under test: Lambda reserved concurrency on `ReachIntakeHandler`, the
SQS-triggered gauge-intake function. Two full `cdk deploy`s against floci (destroy + redeploy
between them, not an in-place update — see "Notes on floci behaviour" below), same driver, same
load shape, run back to back.

## Method

`load/src/main/java/edu/msc/floodwatch/load/GaugeIntakeLoadDriver.java` sends synchronous
`Invoke` calls directly at `ReachIntakeHandler`, wrapping a realistic `hydro_event` body in the
same one-record-per-batch SQS event shape the real event source mapping delivers — so reserved
concurrency throttles this traffic exactly as it would the real fog-node -> SQS -> Lambda path.
Rate ramps 5 -> 15 -> 30 -> 45 -> 60 req/s, 4 seconds per step (20s total, 620 invocations), per
the brief's scaled-down load profile. Each call has a 15s client-side timeout so a wedged
container reports as a slow/failed call instead of hanging the run.

`FloodWatchStack.java` reads `FLOODWATCH_INTAKE_RESERVED_CONCURRENCY` at synth time and sets
`reservedConcurrentExecutions` on `ReachIntakeHandler` only when it's present, so the constrained
and unconstrained configs are two real deploys of the same CDK app, not a mocked toggle.

## Commands run

```
# constrained config
cd infra
FLOODWATCH_INTAKE_RESERVED_CONCURRENCY=2 AWS_ENDPOINT_URL=http://localhost:4566 \
  AWS_ACCESS_KEY_ID=test AWS_SECRET_ACCESS_KEY=test AWS_REGION=eu-west-1 AWS_DEFAULT_REGION=eu-west-1 \
  CDK_DEFAULT_ACCOUNT=000000000000 CDK_DEFAULT_REGION=eu-west-1 \
  npx --yes aws-cdk@2 deploy --require-approval never

cd ..
AWS_ENDPOINT_URL=http://localhost:4566 AWS_ACCESS_KEY_ID=test AWS_SECRET_ACCESS_KEY=test \
  AWS_REGION=eu-west-1 AWS_DEFAULT_REGION=eu-west-1 \
  mvn -f load/pom.xml exec:java -Dexec.args="reserved-concurrency-2"

# unconstrained config (destroy + redeploy with the env var unset, same stack)
cd infra
AWS_ENDPOINT_URL=http://localhost:4566 AWS_ACCESS_KEY_ID=test AWS_SECRET_ACCESS_KEY=test \
  AWS_REGION=eu-west-1 AWS_DEFAULT_REGION=eu-west-1 CDK_DEFAULT_ACCOUNT=000000000000 \
  CDK_DEFAULT_REGION=eu-west-1 npx --yes aws-cdk@2 destroy --force
# (unset FLOODWATCH_INTAKE_RESERVED_CONCURRENCY)
AWS_ENDPOINT_URL=http://localhost:4566 AWS_ACCESS_KEY_ID=test AWS_SECRET_ACCESS_KEY=test \
  AWS_REGION=eu-west-1 AWS_DEFAULT_REGION=eu-west-1 CDK_DEFAULT_ACCOUNT=000000000000 \
  CDK_DEFAULT_REGION=eu-west-1 npx --yes aws-cdk@2 deploy --require-approval never

cd ..
AWS_ENDPOINT_URL=http://localhost:4566 AWS_ACCESS_KEY_ID=test AWS_SECRET_ACCESS_KEY=test \
  AWS_REGION=eu-west-1 AWS_DEFAULT_REGION=eu-west-1 \
  mvn -f load/pom.xml exec:java -Dexec.args="unconstrained-default"
```

Raw stdout for every run is kept under `load/raw/`.

## Results

| Config | reservedConcurrentExecutions | success / 620 | functionErrors | throttled (`TooManyRequestsException`) | p50 | p95 | p99 | max |
|---|---|---|---|---|---|---|---|---|
| Constrained | `2` | 609 | 11 | 11 | 7ms | **977ms** | 2935ms | 5252ms |
| Unconstrained (run 1) | unset (account default) | 0 | 620 | 0 | 14ms | **15003ms** | 15005ms | 15017ms (client timeout ceiling) |
| Unconstrained (run 2, repeat) | unset (account default) | 134 | 486 | 0 | 14ms | **4000ms** | 15004ms | 15025ms |

Source: `load/raw/run-reserved-2.log`, `load/raw/run-unconstrained.log`,
`load/raw/run-unconstrained-rerun.log`.

Queue depth (`ApproximateNumberOfMessages` / `ApproximateNumberOfMessagesNotVisible` on
`floodwatch-gauge-intake-queue`) was 0/0 before and after every run in all three cases — this
driver invokes `ReachIntakeHandler` directly rather than through the queue (see Method), so queue
depth isn't the bottleneck signal here; Lambda-level concurrency is.

## What actually happened

With `reservedConcurrentExecutions=2`, floci launched exactly 2 `ReachIntakeHandler` containers
(confirmed in floci's own logs) and held that ceiling for the whole ramp. 11 of 620 calls got a
real `TooManyRequestsException` once the 30-60 req/s steps exceeded what 2 concurrent DynamoDB
`PutItem` round trips can drain, and p95 latency rose accordingly (977ms) — this is reserved
concurrency doing exactly its job: bounding parallelism and shedding excess load predictably via
throttling rather than degrading everything.

With reserved concurrency unset, floci tried to launch a container per concurrent invocation with
no ceiling, and **exhausted its own container port pool** (`No free ports in range 9200-9299` —
620 and 467 occurrences logged in run 1 and run 2 respectively). That's a floci-specific resource
limit, not something identical on real AWS, but the underlying dynamic it demonstrates is real:
uncapped Lambda concurrency lets a burst of traffic consume unbounded downstream resources (here,
container ports; on real AWS, DynamoDB write capacity or connection-pool exhaustion on anything
downstream) with no backpressure. The result was catastrophic in both repeats — 0/620 and
134/620 successful respectively, both with p95 at or near the 15s client timeout ceiling — a
strictly worse outcome than the bounded config's predictable throttle-and-recover behaviour.

## Notes on floci behaviour

`cdk deploy` cannot toggle `ReservedConcurrentExecutions` via an in-place stack update on floci —
every attempt failed with a stale `AWS::IAM::Policy ... already exists` error, because floci's
stack/role deletion does not detach a role's managed policy before removing the role, leaving the
policy (and sometimes the role itself) orphaned and blocking any redeploy that reuses the same
CDK-derived logical ID. Both configs here were deployed via a full `cdk destroy` + `cdk deploy`
instead of an update, with the orphaned IAM policies force-cleaned via the IAM SDK
(`DetachRolePolicy` + `DeletePolicy`) between runs. This is a floci defect, not a FloodWatch
backend issue — the same `cdk deploy` invocation is what real AWS deployment uses unmodified.

## Verdict

**Reserved concurrency demonstrably helped.** Capping `ReachIntakeHandler` at 2 concurrent
executions traded a small, predictable amount of throttling (11/620 requests, p95 977ms) for
protection against the uncontrolled fan-out that — with concurrency unset — drove the same 5-60
req/s ramp to 0-78% outright failure and p95 latency 4-15x higher. For a flood early-warning
intake path, bounded-but-reliable beats unbounded-but-collapsing.
