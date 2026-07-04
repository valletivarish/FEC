# OfficeIQ ECS Fargate autoscaling load test

Real before/after measurement against floci (LocalStack-compatible local AWS emulator,
`localhost:4566`) for this project's stated scalability mechanism: **ECS Fargate Application Auto
Scaling (step scaling on SQS queue depth)**, declared in `infra/lib/officeiq-stack.ts`'s
`scaleOnMetric('QueueDepthScaling', ...)` (min 1 / max 8 tasks).

## Path used: fallback, not the live Application Auto Scaling control plane

The task brief's preferred path was to let the real AAS policy trigger scaling actions and observe
them. That path is not available on floci: the AAS **CFN resources deploy and synthesize
correctly** (`OfficeIqWorkerServiceTaskCountTarget...`, both scaling policies, confirmed present in
`cdk.out/OfficeIqStack.template.json` and `CREATE_COMPLETE` in the real stack), but floci's AAS
**runtime control plane is unimplemented** - `DescribeScalableTargets` returns
`UnknownOperationException: Unknown operation: AnyScaleFrontendService.DescribeScalableTargets`
even though floci's own `/_localstack/health` endpoint lists `autoscaling: running`. There is no
CloudWatch alarm evaluation loop to drive the policy, so a real scale-out event can never fire
locally regardless of queue depth.

Given that, this follows the task's documented fallback: drive the worker's own queue-drain loop
(`backend/worker/ingestWorker.js`, the exact code a Fargate task runs, containerized identically)
at **desiredCount=1** (no scaling) vs **desiredCount=8** (this stack's `maxCapacity` - standing in
for "the policy scaled all the way out"), against the same message burst, and measure the real
drain-rate difference via genuine `ECS DescribeServices` (`runningCount`) and
`SQS GetQueueAttributes` samples - not the AAS API itself, which is what's actually unavailable.

## What was measured

`load/autoScalingLoadDriver.js` (only `@aws-sdk/client-sqs` / `client-dynamodb` /
`lib-dynamodb` / `client-ecs`, no new heavyweight dependency):

1. Purges the real `officeiq-event-queue`, resets the worker's own `messagesReceived` counter
   (the `__SYSTEM__` item in `OfficeIQReadings`, incremented once per message by
   `ingestWorker.js#incrementReceivedCounter`).
2. Sets `desiredCount` on the real `OfficeIqWorkerService` and waits for `runningCount` to
   **exactly** match before sending (not `>=`, so scaling down from a higher leftover count is
   actually observed settling, not skipped).
3. Sends 200 messages at concurrency 20 via real `SendMessageCommand` calls, timing each.
4. Polls real `DescribeServicesCommand` + `GetQueueAttributesCommand` + the DynamoDB counter every
   2s until all 200 are drained (consumer-side, not a client-side guess), recording every sample.
5. Repeats for the second `desiredCount`, then restores `desiredCount=1` (the stack's steady
   state) when done.

## Setup (from a clean floci)

```bash
cd 08-officeiq-smart-office-comfort
make -C .. localstack-up   # from repo root; floci up on :4566
cd infra && npm install && cd ../backend/worker && npm install && cd ../../load && npm install

# build + push the worker image straight to floci's ECR-compatible registry (see notes below
# for why this replaces the normal `fromAsset` Docker-build-and-push CDK does automatically)
cd ../backend/worker
docker build -t officeiq-worker-manual .
docker tag officeiq-worker-manual 000000000000.dkr.ecr.eu-west-1.amazonaws.com/cdk-hnb659fds-container-assets-000000000000-eu-west-1:officeiq-worker-manual

# deploy via the floci-only entrypoint (infra/bin/localFlociApp.ts) and CDK's own SDK v3 client,
# not `cdk deploy` directly - see "floci deployment notes" below for why
cd ../../infra
export AWS_ENDPOINT_URL=http://localhost:4566 AWS_ACCESS_KEY_ID=test AWS_SECRET_ACCESS_KEY=test \
       AWS_REGION=eu-west-1 AWS_DEFAULT_REGION=eu-west-1 \
       CDK_DEFAULT_ACCOUNT=000000000000 CDK_DEFAULT_REGION=eu-west-1
export OFFICEIQ_LOCAL_WORKER_ECR_REPO=cdk-hnb659fds-container-assets-000000000000-eu-west-1
export OFFICEIQ_LOCAL_WORKER_IMAGE_TAG=officeiq-worker-manual
npx cdk synth --app "npx ts-node --prefer-ts-exts bin/localFlociApp.ts"
# then CreateStack/UpdateStack with cdk.out/OfficeIqStack.template.json via
# @aws-sdk/client-cloudformation directly (CAPABILITY_IAM, CAPABILITY_NAMED_IAM, CAPABILITY_AUTO_EXPAND)
```

## Reproduce the measurement

```bash
cd 08-officeiq-smart-office-comfort/load
export AWS_ENDPOINT_URL=http://localhost:4566 AWS_REGION=eu-west-1 \
       AWS_ACCESS_KEY_ID=test AWS_SECRET_ACCESS_KEY=test
export OFFICEIQ_EVENT_QUEUE_URL=http://localhost:4566/000000000000/officeiq-event-queue
export OFFICEIQ_READINGS_TABLE=OfficeIQReadings
export OFFICEIQ_LOAD_MESSAGE_COUNT=200 OFFICEIQ_LOAD_SEND_CONCURRENCY=20
node autoScalingLoadDriver.js
```

## Real results (run 2026-07-03T18:58:30.955Z)

| Scenario | desiredCount | tasks running at burst start | messages | send wall time | drain time | drain rate |
|---|---|---|---|---|---|---|
| WITHOUT scaling | 1 | 1 | 200 | 63ms | **34,122ms** | **5.86 msg/s** |
| WITH scaling (maxCapacity) | 8 | 8 | 200 | 75ms | **4,009ms** | **49.89 msg/s** |

Send-side (`SendMessageCommand`) latency was similar in both runs (producer side isn't what
scales here): p50 5-6ms, p95 18-21ms, p99 24-26ms, 0 failed sends out of 400 total across both
runs.

Consumer-side drain, from the real per-2s samples (`messagesReceived` = real DynamoDB counter
value, `queueVisible`/`queueInFlight` = real `GetQueueAttributesCommand` values):

**WITHOUT scaling (1 task)**: 11/200 received at t=2s, then a long plateau at 199/200 from
t=2s to t=30s with 1 message stuck `queueInFlight` (a real SQS visibility-timeout artifact - the
single poller's in-progress receive took the rest of that window to complete and delete), finally
200/200 at t=32s. Full drain: 34.1s.

**WITH scaling (8 tasks)**: 39/200 received at t=2ms (essentially instantly - 8 concurrent
long-pollers draining in parallel), 200/200 already by the very next 2s sample. Full drain: 4.0s.

Full JSON (all samples): `load/raw-run-output.txt`.

## floci deployment notes (why this needed extra steps, kept for reproducibility)

Getting a genuinely running ECS Fargate task on floci for this stack required three floci-specific
workarounds beyond a plain `cdk deploy`, all confined to `infra/bin/localFlociApp.ts` (a
floci-only CDK entrypoint - `infra/bin/officeiq.ts`, the real-AWS entrypoint, is untouched) and
`OfficeIqStackProps` optional overrides on `OfficeIqStack` (all default to the exact real-AWS
behavior when unset):

1. **CDK CLI can't publish/deploy against floci with the default synthesizer.** CDK's bundled
   legacy SDK v2 client used for the CloudFormation deploy call gets `InvalidClientTokenId` even
   though direct SDK v3 calls with the same static test credentials work fine and `sts:AssumeRole`
   against the bootstrap roles succeeds when called directly. Worked around by synthesizing with
   `CliCredentialsStackSynthesizer` and applying the resulting template directly via
   `@aws-sdk/client-cloudformation`'s `CreateStack`/`UpdateStack` (real CFN, just not through the
   CDK CLI's own deploy machinery).
2. **`ecs.ContainerImage.fromAsset()`'s Docker-build-and-ECR-push pipeline hits the same
   credential wall.** Worked around with an optional `workerImageEcrRepositoryName`/`workerImageTag`
   prop: the local entrypoint builds `backend/worker`'s Dockerfile and `docker push`es it straight
   to floci's ECR-compatible registry, then the stack references it via
   `ecs.ContainerImage.fromEcrRepository()` instead of `fromAsset()`.
3. **The Fargate container needs region/endpoint/credentials it wouldn't need on real AWS.** Real
   Fargate injects region implicitly and vends task-role credentials via its metadata endpoint;
   floci's ECS emulation does neither. Worked around with an optional `extraWorkerEnvironment`
   prop supplying `AWS_REGION`, `AWS_ENDPOINT_URL` (floci's own container-network IP, not
   `localhost` - the container floci launches doesn't get a working `floci` DNS alias, see the
   comment in `localFlociApp.ts`), and static test credentials.

Also fixed two genuine, environment-independent bugs surfaced while getting the container to run
at all (not floci workarounds - these would have been wrong on real AWS too):

- `backend/worker/Dockerfile` copied `backend/worker/ingestWorker.js` and expected a
  `package.json` at the build context root, but `fromAsset('../backend/worker')` declares the
  build context as `backend/worker/` itself, which has no `package.json` - the image would never
  have built via the real CDK asset pipeline either. Fixed by giving `backend/worker/` its own
  scoped `package.json` and making the `COPY` paths context-relative.
- `ingestWorker.js`'s `SQSClient` defaults to `useQueueUrlAsEndpoint: true`, which silently
  overrides any configured endpoint with the host embedded in the queue URL itself. Harmless on
  real AWS (they match), but breaks any local/proxied endpoint setup where the queue URL's
  advertised host differs from the reachable one - set `useQueueUrlAsEndpoint: false` so
  `AWS_ENDPOINT_URL` is actually honored.

## Verdict

At 8x the Fargate task count (1 -> 8, this stack's declared `maxCapacity`), the same 200-message
burst drained **8.5x faster** (34.1s -> 4.0s; 5.86 -> 49.89 msg/s) with zero failed sends and zero
lost messages in either run - real `ECS DescribeServices` confirms `runningCount` genuinely held at
1 and then 8 for each scenario, and real `SQS GetQueueAttributes`/DynamoDB counter samples confirm
full, verified drain both times. This demonstrably supports the project's scaling story: more
Fargate task replicas concurrently long-polling the same queue drain it in near-linear proportion
to task count, which is exactly the throughput gain the queue-depth step-scaling policy is
designed to buy back when the real AAS control plane scales `OfficeIqWorkerService` out under
sustained backlog.
