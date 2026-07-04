'use strict';

// Before/after measurement for this project's stated scalability mechanism: ECS Fargate
// Application Auto Scaling target-tracking (step scaling in this case) on SQS queue depth
// (infra/lib/officeiq-stack.ts's scaleOnMetric). floci's Application Auto Scaling control plane
// returns UnknownOperationException for DescribeScalableTargets (confirmed separately - the
// runtime API is unimplemented even though the CFN resources deploy and floci's health check
// lists "autoscaling" as running), so this drives the fallback the task brief calls for:
// running the worker's own queue-drain loop at desiredCount=1 vs desiredCount=8 (this stack's
// maxCapacity) and measuring real drain-rate difference, with real ECS DescribeServices and SQS
// GetQueueAttributes samples throughout - not the AAS control plane itself.

const { SQSClient, SendMessageCommand, GetQueueAttributesCommand, PurgeQueueCommand } = require('@aws-sdk/client-sqs');
const { DynamoDBClient } = require('@aws-sdk/client-dynamodb');
const { DynamoDBDocumentClient, GetCommand, PutCommand } = require('@aws-sdk/lib-dynamodb');
const { ECSClient, ListClustersCommand, ListServicesCommand, UpdateServiceCommand, DescribeServicesCommand } = require('@aws-sdk/client-ecs');

const ENDPOINT = process.env.AWS_ENDPOINT_URL || 'http://localhost:4566';
const REGION = process.env.AWS_REGION || 'eu-west-1';
const CREDS = { accessKeyId: 'test', secretAccessKey: 'test' };
const QUEUE_URL = process.env.OFFICEIQ_EVENT_QUEUE_URL;
const TABLE_NAME = process.env.OFFICEIQ_READINGS_TABLE || 'OfficeIQReadings';
const MESSAGE_COUNT = parseInt(process.env.OFFICEIQ_LOAD_MESSAGE_COUNT || '150', 10);
const SEND_CONCURRENCY = parseInt(process.env.OFFICEIQ_LOAD_SEND_CONCURRENCY || '20', 10);
const DRAIN_TIMEOUT_MS = parseInt(process.env.OFFICEIQ_LOAD_DRAIN_TIMEOUT_MS || '120000', 10);
const SAMPLE_INTERVAL_MS = 2000;

const sqs = new SQSClient({ endpoint: ENDPOINT, region: REGION, credentials: CREDS, useQueueUrlAsEndpoint: false });
const ddb = DynamoDBDocumentClient.from(new DynamoDBClient({ endpoint: ENDPOINT, region: REGION, credentials: CREDS }));
const ecs = new ECSClient({ endpoint: ENDPOINT, region: REGION, credentials: CREDS });

const SYSTEM_COUNTERS_ZONE_ID = '__SYSTEM__';
const SYSTEM_COUNTERS_SORT_KEY = 'system_counters#totals';

function sleep(ms) { return new Promise((r) => setTimeout(r, ms)); }

async function getReceivedCount() {
  const res = await ddb.send(new GetCommand({
    TableName: TABLE_NAME,
    Key: { zoneId: SYSTEM_COUNTERS_ZONE_ID, eventTypeTimestamp: SYSTEM_COUNTERS_SORT_KEY },
  }));
  return res.Item ? res.Item.messagesReceived : 0;
}

async function resetReceivedCount() {
  // overwrite the counter item directly rather than deleting the queue's DLQ/history - isolates
  // each run's drain measurement from whatever earlier runs or other tests wrote
  await ddb.send(new PutCommand({
    TableName: TABLE_NAME,
    Item: { zoneId: SYSTEM_COUNTERS_ZONE_ID, eventTypeTimestamp: SYSTEM_COUNTERS_SORT_KEY, messagesReceived: 0 },
  }));
}

async function getQueueAttributes() {
  const res = await sqs.send(new GetQueueAttributesCommand({
    QueueUrl: QUEUE_URL,
    AttributeNames: ['ApproximateNumberOfMessages', 'ApproximateNumberOfMessagesNotVisible'],
  }));
  return {
    visible: parseInt(res.Attributes.ApproximateNumberOfMessages, 10),
    inFlight: parseInt(res.Attributes.ApproximateNumberOfMessagesNotVisible, 10),
  };
}

async function findClusterAndService() {
  const clusters = await ecs.send(new ListClustersCommand({}));
  const cluster = clusters.clusterArns.find((c) => c.includes('OfficeIq'));
  const services = await ecs.send(new ListServicesCommand({ cluster }));
  const service = services.serviceArns.find((s) => s.includes('WorkerService'));
  return { cluster, service };
}

async function setDesiredCount(cluster, service, count) {
  await ecs.send(new UpdateServiceCommand({ cluster, service, desiredCount: count }));
}

// waits for an exact match, not >=, so scaling DOWN from a leftover higher count (e.g. a prior
// run left 8 tasks up) is actually observed settling to the target before the burst is sent
async function waitForRunningCount(cluster, service, target, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const desc = await ecs.send(new DescribeServicesCommand({ cluster, services: [service] }));
    const running = desc.services[0].runningCount;
    if (running === target) return running;
    if (Date.now() > deadline) return running;
    await sleep(2000);
  }
}

async function sendBurst(count, concurrency) {
  const latencies = [];
  let sent = 0;
  let failed = 0;
  const start = Date.now();

  async function worker() {
    while (sent < count) {
      const idx = sent++;
      const t0 = Date.now();
      try {
        await sqs.send(new SendMessageCommand({
          QueueUrl: QUEUE_URL,
          MessageBody: JSON.stringify({
            type: 'temperature',
            zoneId: `ZONE-LOAD-${idx % 10}`,
            timestamp: new Date().toISOString(),
            value: 20 + (idx % 5),
          }),
        }));
        latencies.push(Date.now() - t0);
      } catch (e) {
        failed++;
      }
    }
  }

  await Promise.all(Array.from({ length: concurrency }, worker));
  return { wallMs: Date.now() - start, latencies, failed };
}

function percentile(sorted, p) {
  const idx = Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length));
  return sorted[idx];
}

async function runScenario(label, cluster, service, desiredCount) {
  console.log(`\n=== Scenario: ${label} (desiredCount=${desiredCount}) ===`);

  // purge and wait - floci purge is near-instant but give it a moment to settle
  await sqs.send(new PurgeQueueCommand({ QueueUrl: QUEUE_URL })).catch(() => {});
  await sleep(1000);
  await resetReceivedCount();

  await setDesiredCount(cluster, service, desiredCount);
  const settledRunning = await waitForRunningCount(cluster, service, desiredCount, 90000);
  console.log(`  tasks running before burst: ${settledRunning}/${desiredCount}`);

  const sendResult = await sendBurst(MESSAGE_COUNT, SEND_CONCURRENCY);
  console.log(`  sent ${MESSAGE_COUNT} messages in ${sendResult.wallMs}ms (${sendResult.failed} failed)`);

  // poll drain progress: real consumer-side count (DynamoDB counter) + real queue depth (SQS)
  const samples = [];
  const drainStart = Date.now();
  let received = 0;
  while (received < MESSAGE_COUNT && Date.now() - drainStart < DRAIN_TIMEOUT_MS) {
    const [rc, qa, svc] = await Promise.all([
      getReceivedCount(),
      getQueueAttributes(),
      ecs.send(new DescribeServicesCommand({ cluster, services: [service] })),
    ]);
    received = rc;
    samples.push({
      tMs: Date.now() - drainStart,
      messagesReceived: rc,
      queueVisible: qa.visible,
      queueInFlight: qa.inFlight,
      desiredCount: svc.services[0].desiredCount,
      runningCount: svc.services[0].runningCount,
    });
    await sleep(SAMPLE_INTERVAL_MS);
  }
  const drainMs = Date.now() - drainStart;
  const drained = received >= MESSAGE_COUNT;

  const sorted = [...sendResult.latencies].sort((a, b) => a - b);
  const result = {
    label,
    desiredCount,
    tasksRunningAtStart: settledRunning,
    messageCount: MESSAGE_COUNT,
    sendConcurrency: SEND_CONCURRENCY,
    sendWallMs: sendResult.wallMs,
    sendFailed: sendResult.failed,
    sendLatencyMs: {
      p50: percentile(sorted, 50),
      p95: percentile(sorted, 95),
      p99: percentile(sorted, 99),
      min: sorted[0],
      max: sorted[sorted.length - 1],
    },
    drained,
    drainMs,
    drainRateMsgPerSec: Number((MESSAGE_COUNT / (drainMs / 1000)).toFixed(2)),
    samples,
  };

  console.log(`  drained ${received}/${MESSAGE_COUNT} in ${drainMs}ms -> ${result.drainRateMsgPerSec} msg/s (drained=${drained})`);
  return result;
}

async function main() {
  if (!QUEUE_URL) throw new Error('OFFICEIQ_EVENT_QUEUE_URL env var is required');

  const { cluster, service } = await findClusterAndService();
  console.log('cluster:', cluster);
  console.log('service:', service);

  const withoutScaling = await runScenario('WITHOUT scaling (fixed 1 task)', cluster, service, 1);
  const withScaling = await runScenario('WITH scaling (8 tasks - this stack maxCapacity)', cluster, service, 8);

  // restore to the stack's steady-state desiredCount so the deployment is left as CDK declared it
  await setDesiredCount(cluster, service, 1);

  const output = {
    ranAt: new Date().toISOString(),
    endpoint: ENDPOINT,
    queueUrl: QUEUE_URL,
    tableName: TABLE_NAME,
    results: [withoutScaling, withScaling],
  };

  console.log('\n=== FULL JSON RESULT ===');
  console.log(JSON.stringify(output, null, 2));
}

main().catch((e) => {
  console.error('FATAL', e);
  process.exit(1);
});
