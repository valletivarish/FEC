// Load-drives the real scalability mechanism named in the brief: the SQS ingest queue plus
// IngestEventFunction's reservedConcurrentExecutions=20. Each simulated zone plays the same
// role as fog/shared/greenhouseEventDispatcher.js -- POSTing one event body at a time -- so a
// "zone" here is a burst of concurrent calls into the real relayIngestEvent handler (the exact
// code the deployed API Gateway route runs), which forwards onto the real deployed floci SQS
// queue. Concurrency is measured at the relay call (the API-facing latency a fog node would see)
// while queue depth/DLQ depth come from real GetQueueAttributesCommand reads, and processed-count
// comes from the faults/command-ledger counters row IngestEventFunction really writes.
const path = require('path');
const { SQSClient, GetQueueUrlCommand, GetQueueAttributesCommand, PurgeQueueCommand } = require('@aws-sdk/client-sqs');
const { DynamoDBClient } = require('@aws-sdk/client-dynamodb');
const { DynamoDBDocumentClient, GetCommand } = require('@aws-sdk/lib-dynamodb');

const QUEUE_NAME = 'greenhouseguard-ingest-queue';
const DLQ_NAME = 'greenhouseguard-ingest-dlq';
const FAULTS_TABLE = process.env.GREENHOUSEGUARD_FAULTS_TABLE || 'greenhouseguard-faults-table';
const READINGS_PER_ZONE = 4; // batched readings+faults per zone per tick, matching one fog dispatch burst

// this floci container is shared live across all 15 sibling projects' test suites, so a slightly
// higher retry count than the SDK default absorbs transient ECONNRESET from concurrent container
// churn without masking genuine failures (still surfaces after 6 attempts)
const sqs = new SQSClient({ maxAttempts: 6 });
const ddb = DynamoDBDocumentClient.from(new DynamoDBClient({ maxAttempts: 6 }));

const EVENT_TYPES = ['fertigation_event', 'enclosure_fault_event', 'dli_event', 'setpoint_command'];

function buildEvent(zoneId, i) {
  const type = EVENT_TYPES[i % EVENT_TYPES.length];
  return {
    type,
    zoneId,
    metric: type === 'fertigation_event' ? 'ec' : 'vent_position',
    severity: i % 3 === 0 ? 'CRITICAL' : 'WARNING',
    value: Number((Math.random() * 10).toFixed(2)),
    timestamp: new Date().toISOString(),
  };
}

function percentile(sortedMs, p) {
  if (sortedMs.length === 0) return 0;
  const idx = Math.min(sortedMs.length - 1, Math.ceil((p / 100) * sortedMs.length) - 1);
  return sortedMs[Math.max(0, idx)];
}

async function relayOneEvent(handler, zoneId, i) {
  const body = JSON.stringify(buildEvent(zoneId, i));
  const start = performance.now();
  // one retry absorbs the shared floci container's occasional connection resets under concurrent
  // cross-project load without hiding a real failure (a second consecutive failure still throws)
  let response;
  try {
    response = await handler({ body });
  } catch (err) {
    if (err.code !== 'ECONNRESET' && err.name !== 'TimeoutError') throw err;
    response = await handler({ body });
  }
  const elapsedMs = performance.now() - start;
  if (response.statusCode !== 202) {
    throw new Error(`relay rejected event: ${response.statusCode}`);
  }
  return elapsedMs;
}

async function runLevel(handler, zoneCount) {
  const calls = [];
  for (let z = 0; z < zoneCount; z++) {
    const zoneId = `load-zone-${z}`;
    for (let i = 0; i < READINGS_PER_ZONE; i++) {
      calls.push(relayOneEvent(handler, zoneId, i));
    }
  }

  const wallStart = performance.now();
  const settled = await Promise.allSettled(calls);
  const wallElapsedMs = performance.now() - wallStart;

  const latencies = settled.filter(s => s.status === 'fulfilled').map(s => s.value).sort((a, b) => a - b);
  const failed = settled.filter(s => s.status === 'rejected').length;

  return {
    zoneCount,
    totalEvents: calls.length,
    wallElapsedMs: Number(wallElapsedMs.toFixed(1)),
    failed,
    latencyMs: {
      p50: Number(percentile(latencies, 50).toFixed(2)),
      p95: Number(percentile(latencies, 95).toFixed(2)),
      p99: Number(percentile(latencies, 99).toFixed(2)),
      min: latencies.length ? Number(latencies[0].toFixed(2)) : 0,
      max: latencies.length ? Number(latencies[latencies.length - 1].toFixed(2)) : 0,
    },
  };
}

async function readQueueDepth(queueUrl) {
  const attrs = await sqs.send(new GetQueueAttributesCommand({
    QueueUrl: queueUrl,
    AttributeNames: ['ApproximateNumberOfMessages', 'ApproximateNumberOfMessagesNotVisible'],
  }));
  return {
    visible: Number(attrs.Attributes.ApproximateNumberOfMessages),
    inFlight: Number(attrs.Attributes.ApproximateNumberOfMessagesNotVisible),
  };
}

async function readCounters() {
  const result = await ddb.send(new GetCommand({
    TableName: FAULTS_TABLE,
    Key: { zoneId: '__counters__', eventTypeTimestamp: 'system_message_counters' },
  }));
  return result.Item || { messagesReceived: 0, messagesStored: 0 };
}

async function waitForDrain(queueUrl, maxWaitMs) {
  const deadline = Date.now() + maxWaitMs;
  let depth = await readQueueDepth(queueUrl);
  while ((depth.visible > 0 || depth.inFlight > 0) && Date.now() < deadline) {
    await new Promise(r => setTimeout(r, 500));
    depth = await readQueueDepth(queueUrl);
  }
  return depth;
}

async function main() {
  const { handler } = require(path.join(__dirname, '../backend/functions/relayIngestEvent'));

  const { QueueUrl: queueUrl } = await sqs.send(new GetQueueUrlCommand({ QueueName: QUEUE_NAME }));
  const { QueueUrl: dlqUrl } = await sqs.send(new GetQueueUrlCommand({ QueueName: DLQ_NAME }));

  console.log('Purging ingest queue and DLQ before run...');
  await sqs.send(new PurgeQueueCommand({ QueueUrl: queueUrl })).catch(() => {});
  await sqs.send(new PurgeQueueCommand({ QueueUrl: dlqUrl })).catch(() => {});
  await new Promise(r => setTimeout(r, 2000)); // floci purge settle

  const countersBefore = await readCounters();

  const levels = [5, 10, 20, 40];
  const results = [];

  for (const zoneCount of levels) {
    console.log(`\n--- Level: ${zoneCount} zones (${zoneCount * READINGS_PER_ZONE} events) ---`);
    const levelResult = await runLevel(handler, zoneCount);
    console.log(`Relay-call latency (fog-node-facing): p50=${levelResult.latencyMs.p50}ms p95=${levelResult.latencyMs.p95}ms p99=${levelResult.latencyMs.p99}ms, wall=${levelResult.wallElapsedMs}ms, failed=${levelResult.failed}`);

    // give the real deployed IngestEventFunction (reservedConcurrentExecutions=20) a bounded
    // window to drain the queue via its real SQS event-source mapping before reading depth
    const depthAfterDrainWindow = await waitForDrain(queueUrl, 15000);
    const dlqDepth = await readQueueDepth(dlqUrl);

    results.push({
      ...levelResult,
      queueDepthAfter15sWindow: depthAfterDrainWindow,
      dlqDepth,
      ranAt: new Date().toISOString(),
    });

    console.log(`Queue depth after 15s drain window: visible=${depthAfterDrainWindow.visible} inFlight=${depthAfterDrainWindow.inFlight}, DLQ depth: ${dlqDepth.visible}`);
  }

  const countersAfter = await readCounters();

  const output = {
    ranAt: new Date().toISOString(),
    reservedConcurrentExecutions: 20,
    readingsPerZonePerTick: READINGS_PER_ZONE,
    queueUrl,
    dlqUrl,
    countersBefore,
    countersAfter,
    messagesActuallyProcessedByLambda: (countersAfter.messagesStored || 0) - (countersBefore.messagesStored || 0),
    results,
  };

  console.log('\n=== FULL JSON RESULT ===');
  console.log(JSON.stringify(output, null, 2));
}

main().catch(err => {
  console.error('Load test failed:', err);
  process.exit(1);
});
