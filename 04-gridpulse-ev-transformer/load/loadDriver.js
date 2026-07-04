'use strict';

// Load-test driver for the Kinesis scaling lever (see load/results.md).
// Puts synthetic bay_setpoint records directly on the stream at a target msg/s rate for a fixed
// duration, ramping 50 -> 300 msg/s (scaled down from the brief's 2000 msg/s so a shared local
// floci container stays responsive for other projects' tests running alongside this one),
// records true PutRecord latency (client-observed, matches what a fog agent would see), then
// polls the ops-counters DynamoDB item to measure consumer lag: how long after the last record
// was accepted did the Lambda-driven consumer finish writing it out.

const path = require('path');
const { KinesisClient, PutRecordCommand, DescribeStreamSummaryCommand } = require(
  path.join(__dirname, '..', 'backend', 'node_modules', '@aws-sdk', 'client-kinesis')
);
const { DynamoDBClient } = require(
  path.join(__dirname, '..', 'backend', 'node_modules', '@aws-sdk', 'client-dynamodb')
);
const { DynamoDBDocumentClient, GetCommand } = require(
  path.join(__dirname, '..', 'backend', 'node_modules', '@aws-sdk', 'lib-dynamodb')
);

const ENDPOINT = process.env.AWS_ENDPOINT_URL || 'http://localhost:4566';
const REGION = process.env.AWS_REGION || 'eu-west-1';
const STREAM_NAME = process.env.GRIDPULSE_STREAM_NAME || 'gridpulse-telemetry-stream';
const OPS_COUNTERS_TABLE = process.env.GRIDPULSE_OPS_COUNTERS_TABLE || 'GridPulseOpsCounters';
const OPS_COUNTERS_ID = 'gridpulse-backend';

const creds = { accessKeyId: 'test', secretAccessKey: 'test' };
const kinesis = new KinesisClient({ endpoint: ENDPOINT, region: REGION, credentials: creds });
const ddb = DynamoDBDocumentClient.from(new DynamoDBClient({ endpoint: ENDPOINT, region: REGION, credentials: creds }));

// scaled-down ramp: 50 -> 300 msg/s across 6 steps, 3s per step (brief's 2000 msg/s target scaled
// down ~7x to stay a fast, reproducible measurement against a shared local emulator, not a stress test)
const RAMP_STEPS_MSG_PER_SEC = [50, 100, 150, 200, 250, 300];
const STEP_DURATION_MS = 3000;

function buildRecord(seq) {
  const bayId = `bay-0${(seq % 6) + 1}`;
  const event = {
    type: 'bay_setpoint',
    hubId: 'hub-01',
    bayId,
    setpointAmps: 16 + (seq % 10),
    timestamp: new Date().toISOString(),
    loadTestSeq: seq,
  };
  return event;
}

async function sendOne(seq, latencies, errors) {
  const event = buildRecord(seq);
  const start = process.hrtime.bigint();
  try {
    await kinesis.send(new PutRecordCommand({
      StreamName: STREAM_NAME,
      Data: Buffer.from(JSON.stringify(event)),
      PartitionKey: event.hubId,
    }));
    const end = process.hrtime.bigint();
    latencies.push(Number(end - start) / 1e6); // ms
  } catch (err) {
    errors.push(err.message);
  }
}

function percentile(sortedArr, p) {
  if (sortedArr.length === 0) return null;
  const idx = Math.min(sortedArr.length - 1, Math.ceil((p / 100) * sortedArr.length) - 1);
  return sortedArr[idx];
}

async function readOpsCounters() {
  const res = await ddb.send(new GetCommand({ TableName: OPS_COUNTERS_TABLE, Key: { counterId: OPS_COUNTERS_ID } }));
  return res.Item || { messagesReceived: 0, messagesStored: 0 };
}

// fires PutRecord calls concurrently at the target rate rather than one-at-a-time-then-wait, so
// achieved throughput reflects the stream's real capacity instead of this script's own await chain
async function runStep(targetMsgPerSec, seqStart, latencies, errors) {
  const intervalMs = 1000 / targetMsgPerSec;
  const stepStart = Date.now();
  let seq = seqStart;
  const inFlight = [];
  while (Date.now() - stepStart < STEP_DURATION_MS) {
    inFlight.push(sendOne(seq, latencies, errors));
    seq += 1;
    await new Promise((r) => setTimeout(r, intervalMs));
  }
  await Promise.all(inFlight);
  return seq;
}

// polls ops-counters until it reflects every record this run sent (or the deadline passes),
// logging progress so the drain rate itself — the real consumer-side bottleneck — is visible
async function waitForDrain(receivedBefore, totalSent, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  let after = await readOpsCounters();
  let lastLogged = Number(after.messagesReceived || 0);
  while (Number(after.messagesReceived || 0) - receivedBefore < totalSent && Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, 2000));
    after = await readOpsCounters();
    const current = Number(after.messagesReceived || 0);
    if (current !== lastLogged) {
      console.log(`[loadDriver] draining... messagesReceived=${current} (+${current - receivedBefore}/${totalSent})`);
      lastLogged = current;
    }
  }
  return after;
}

async function main() {
  const shardSummary = await kinesis.send(new DescribeStreamSummaryCommand({ StreamName: STREAM_NAME }));
  const shardCount = shardSummary.StreamDescriptionSummary.OpenShardCount;
  console.log(`[loadDriver] stream=${STREAM_NAME} shardCount=${shardCount} endpoint=${ENDPOINT}`);

  const before = await readOpsCounters();
  console.log(`[loadDriver] ops counters before: ${JSON.stringify(before)}`);

  const latencies = [];
  const errors = [];
  let seq = 0;
  const runStart = Date.now();

  for (const rate of RAMP_STEPS_MSG_PER_SEC) {
    const stepStartedAt = Date.now();
    seq = await runStep(rate, seq, latencies, errors);
    const elapsed = Date.now() - stepStartedAt;
    console.log(`[loadDriver] step target=${rate}msg/s sent=${seq} elapsedMs=${elapsed}`);
  }

  const runEnd = Date.now();
  const totalSent = seq;
  const totalDurationSec = (runEnd - runStart) / 1000;
  const achievedRate = totalSent / totalDurationSec;

  const sorted = [...latencies].sort((a, b) => a - b);
  const p50 = percentile(sorted, 50);
  const p95 = percentile(sorted, 95);
  const p99 = percentile(sorted, 99);
  const max = sorted[sorted.length - 1];
  const min = sorted[0];
  const avg = sorted.reduce((a, b) => a + b, 0) / sorted.length;

  // consumer lag: poll ops-counters until it reflects all sent records (or timeout), which tells us
  // how long the Kinesis-Lambda-DynamoDB pipeline took to drain what was just produced
  const lastRecordAcceptedAt = Date.now();
  const receivedBefore = Number(before.messagesReceived || 0);
  const after = await waitForDrain(receivedBefore, totalSent, 120000);
  const drainedAt = Date.now();
  const consumerLagMs = drainedAt - lastRecordAcceptedAt;
  const drainedFully = Number(after.messagesReceived || 0) - receivedBefore >= totalSent;
  const drainedCount = Number(after.messagesReceived || 0) - receivedBefore;
  const drainRateMsgPerSec = Number((drainedCount / (consumerLagMs / 1000)).toFixed(1));

  const result = {
    shardCount,
    totalSent,
    totalErrors: errors.length,
    totalDurationSec: Number(totalDurationSec.toFixed(2)),
    achievedRateMsgPerSec: Number(achievedRate.toFixed(1)),
    putRecordLatencyMs: {
      min: Number(min.toFixed(2)),
      avg: Number(avg.toFixed(2)),
      p50: Number(p50.toFixed(2)),
      p95: Number(p95.toFixed(2)),
      p99: Number(p99.toFixed(2)),
      max: Number(max.toFixed(2)),
    },
    consumerLagMsAfterLastRecord: consumerLagMs,
    drainedFully,
    drainedCount,
    drainRateMsgPerSec,
    opsCountersBefore: before,
    opsCountersAfter: after,
  };

  console.log('[loadDriver] RESULT ' + JSON.stringify(result, null, 2));
}

main().catch((err) => {
  console.error('[loadDriver] fatal error', err);
  process.exit(1);
});
