'use strict';

// Same mechanism as ingestLoadTest.js but purges the queue before each concurrency level so
// depth/latency readings at low vs high concurrency are directly comparable snapshots, not
// cumulative across levels. Used for the headline before/after figures in load/results.md.

const { SQSClient, SendMessageCommand, GetQueueAttributesCommand, PurgeQueueCommand } = require('@aws-sdk/client-sqs');

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
  return { zoneId, topic, value: Math.round(Math.random() * 1000) / 10, timestamp: new Date().toISOString() };
}

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
          MessageDeduplicationId: `iso-pub${publisherId}-seq${seq}-${Date.now()}-${Math.random()}`,
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
  return { visible: Number(Attributes.ApproximateNumberOfMessages), inFlight: Number(Attributes.ApproximateNumberOfMessagesNotVisible) };
}

function percentile(sortedValues, p) {
  if (sortedValues.length === 0) return null;
  const idx = Math.ceil((p / 100) * sortedValues.length) - 1;
  return sortedValues[Math.min(idx, sortedValues.length - 1)];
}

function summarize(latencies) {
  const ok = latencies.filter((v) => v !== null).sort((a, b) => a - b);
  return {
    failed: latencies.length - ok.length,
    p50: percentile(ok, 50),
    p95: percentile(ok, 95),
    p99: percentile(ok, 99),
    max: ok.length ? ok[ok.length - 1] : null,
    min: ok.length ? ok[0] : null,
  };
}

async function runLevel(concurrency, messagesPerPublisher) {
  await client.send(new PurgeQueueCommand({ QueueUrl: QUEUE_URL })).catch(() => {});
  // floci needs a moment after purge before ApproximateNumberOfMessages reliably reads back 0.
  await new Promise((r) => setTimeout(r, 3000));

  const latencies = [];
  const wallStart = performance.now();
  await Promise.all(Array.from({ length: concurrency }, (_, i) => runPublisher(i, messagesPerPublisher, latencies)));
  const wallElapsedMs = performance.now() - wallStart;
  const depthImmediatelyAfter = await getQueueDepth();
  const stats = summarize(latencies);

  return {
    concurrency,
    messagesPerPublisher,
    totalMessages: concurrency * messagesPerPublisher,
    wallElapsedMs: Math.round(wallElapsedMs),
    throughputMsgPerSec: Math.round(((concurrency * messagesPerPublisher) / (wallElapsedMs / 1000)) * 10) / 10,
    depthImmediatelyAfter,
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
  const levels = [5, 40];
  const messagesPerPublisher = 20;
  const results = [];

  console.log(`CampusPulse ingest load test (isolated levels) - ${new Date().toISOString()}`);
  console.log(`Target queue: ${QUEUE_URL}`);
  console.log(`Levels: ${levels.join(' vs ')} concurrent publishers, ${messagesPerPublisher} messages each, queue purged before each level\n`);

  for (const concurrency of levels) {
    process.stdout.write(`running concurrency=${concurrency}... `);
    const result = await runLevel(concurrency, messagesPerPublisher);
    results.push(result);
    console.log(
      `p95=${result.latencyMs.p95}ms throughput=${result.throughputMsgPerSec}msg/s ` +
      `depth=${result.depthImmediatelyAfter.visible} failed=${result.failed}`
    );
  }

  console.log('\n--- JSON summary ---');
  console.log(JSON.stringify({ ranAt: new Date().toISOString(), queueUrl: QUEUE_URL, results }, null, 2));
}

main().catch((err) => {
  console.error('load test failed:', err);
  process.exit(1);
});
