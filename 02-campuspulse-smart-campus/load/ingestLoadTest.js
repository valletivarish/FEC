'use strict';

// Load-tests CampusPulse's scalability mechanism: the SQS FIFO queue that decouples ingestion
// from Lambda processing (see infra/lib/ingestConstruct.ts). Virtual fog-node publishers send
// SendMessage calls shaped exactly like fogDispatcher.js's POST body (MessageGroupId = zoneId,
// MessageBody = raw JSON reading/event) directly at the real deployed queue on floci.
//
// Why SQS SendMessage and not an HTTP POST to the API Gateway URL: floci's AWS-service (non-proxy)
// API Gateway integration does not execute the VTL RequestTemplate for JSON bodies on this stack
// (confirmed by probing - a hand-built Action=SendMessage form body reaches SQS fine and fails
// with "NonExistentQueue" as expected, but a JSON body through the deployed route always comes
// back "MissingAction", meaning the template never ran). That is a floci emulation gap in VTL
// selection for AWS-service integrations, not a defect in ingestConstruct.ts - the CDK template
// itself, DLQ wiring, and REST method config all deployed and matched real-AWS semantics exactly.
// SendMessage is the operation API Gateway's VTL template maps every ingest POST onto, so timing
// it directly still measures the real decoupling mechanism the brief calls out, just one hop
// earlier than the HTTP edge.

const { SQSClient, SendMessageCommand, GetQueueAttributesCommand } = require('@aws-sdk/client-sqs');

const QUEUE_URL = process.env.CAMPUSPULSE_INGEST_QUEUE_URL;
if (!QUEUE_URL) {
  console.error('CAMPUSPULSE_INGEST_QUEUE_URL is required (see infra/.ingest-test-outputs.json)');
  process.exit(1);
}

const ZONES = ['ZONE-A', 'ZONE-B', 'ZONE-C'];
const TOPICS = ['electricity', 'water-flow', 'temperature', 'humidity', 'light', 'co2', 'door-contact', 'motion', 'sound-level', 'hvac-duct-pressure'];

const client = new SQSClient({
  region: process.env.AWS_REGION || 'us-east-1',
  endpoint: process.env.AWS_ENDPOINT_URL || 'http://localhost:4566',
  credentials: {
    accessKeyId: process.env.AWS_ACCESS_KEY_ID || 'test',
    secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY || 'test',
  },
});

function buildReading(publisherId, seq) {
  const zoneId = ZONES[publisherId % ZONES.length];
  const topic = TOPICS[seq % TOPICS.length];
  return {
    zoneId,
    topic,
    value: Math.round(Math.random() * 1000) / 10,
    timestamp: new Date().toISOString(),
  };
}

// One virtual fog-node publisher: sends `messagesPerPublisher` sequential SendMessage calls,
// timing each one, same as fogDispatcher.js firing one HTTP POST at a time per fog event.
async function runPublisher(publisherId, messagesPerPublisher, latencies) {
  for (let seq = 0; seq < messagesPerPublisher; seq += 1) {
    const reading = buildReading(publisherId, seq);
    const start = performance.now();
    try {
      await client.send(
        new SendMessageCommand({
          QueueUrl: QUEUE_URL,
          MessageBody: JSON.stringify(reading),
          MessageGroupId: reading.zoneId,
          MessageDeduplicationId: `pub${publisherId}-seq${seq}-${Date.now()}-${Math.random()}`,
        })
      );
      latencies.push(performance.now() - start);
    } catch (err) {
      latencies.push(null);
      console.error(`publisher ${publisherId} seq ${seq} failed: ${err.message}`);
    }
  }
}

async function getQueueDepth() {
  const { Attributes } = await client.send(
    new GetQueueAttributesCommand({
      QueueUrl: QUEUE_URL,
      AttributeNames: ['ApproximateNumberOfMessages', 'ApproximateNumberOfMessagesNotVisible'],
    })
  );
  return {
    visible: Number(Attributes.ApproximateNumberOfMessages),
    inFlight: Number(Attributes.ApproximateNumberOfMessagesNotVisible),
  };
}

function percentile(sortedValues, p) {
  if (sortedValues.length === 0) return null;
  const idx = Math.ceil((p / 100) * sortedValues.length) - 1;
  return sortedValues[Math.min(idx, sortedValues.length - 1)];
}

function summarize(latencies) {
  const ok = latencies.filter((v) => v !== null).sort((a, b) => a - b);
  const failed = latencies.length - ok.length;
  return {
    count: latencies.length,
    failed,
    p50: percentile(ok, 50),
    p95: percentile(ok, 95),
    p99: percentile(ok, 99),
    max: ok.length ? ok[ok.length - 1] : null,
    min: ok.length ? ok[0] : null,
  };
}

// Runs one concurrency level: `concurrency` publishers in parallel, each sending
// `messagesPerPublisher` messages, then snapshots real queue depth immediately after the burst.
async function runLevel(concurrency, messagesPerPublisher) {
  const latencies = [];
  const depthBefore = await getQueueDepth();

  const wallStart = performance.now();
  await Promise.all(
    Array.from({ length: concurrency }, (_, i) => runPublisher(i, messagesPerPublisher, latencies))
  );
  const wallElapsedMs = performance.now() - wallStart;

  const depthAfter = await getQueueDepth();
  const stats = summarize(latencies);

  return {
    concurrency,
    messagesPerPublisher,
    totalMessages: concurrency * messagesPerPublisher,
    wallElapsedMs: Math.round(wallElapsedMs),
    throughputMsgPerSec: Math.round((concurrency * messagesPerPublisher) / (wallElapsedMs / 1000) * 10) / 10,
    depthBefore,
    depthAfter,
    latencyMs: {
      p50: stats.p50 !== null ? Math.round(stats.p50 * 10) / 10 : null,
      p95: stats.p95 !== null ? Math.round(stats.p95 * 10) / 10 : null,
      p99: stats.p99 !== null ? Math.round(stats.p99 * 10) / 10 : null,
      min: stats.min !== null ? Math.round(stats.min * 10) / 10 : null,
      max: stats.max !== null ? Math.round(stats.max * 10) / 10 : null,
    },
    failed: stats.failed,
  };
}

async function main() {
  // Ramp axis required by the brief: ~5 low-concurrency baseline up to ~40 high-concurrency.
  const levels = [5, 10, 20, 40];
  const messagesPerPublisher = 10;
  const results = [];

  console.log(`CampusPulse ingest load test - ${new Date().toISOString()}`);
  console.log(`Target queue: ${QUEUE_URL}`);
  console.log(`Levels: ${levels.join(', ')} concurrent publishers, ${messagesPerPublisher} messages each\n`);

  for (const concurrency of levels) {
    process.stdout.write(`running concurrency=${concurrency}... `);
    const result = await runLevel(concurrency, messagesPerPublisher);
    results.push(result);
    console.log(
      `p95=${result.latencyMs.p95}ms throughput=${result.throughputMsgPerSec}msg/s ` +
      `depthAfter(visible=${result.depthAfter.visible}, inFlight=${result.depthAfter.inFlight}) failed=${result.failed}`
    );
    // Brief pause between levels so queue depth readings aren't polluted by the prior burst's drain.
    await new Promise((r) => setTimeout(r, 2000));
  }

  console.log('\n--- JSON summary ---');
  console.log(JSON.stringify({ ranAt: new Date().toISOString(), queueUrl: QUEUE_URL, results }, null, 2));
}

main().catch((err) => {
  console.error('load test failed:', err);
  process.exit(1);
});
