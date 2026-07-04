// Load-test driver for the ingestBayEvents scalability mechanism: Lambda reserved concurrency.
// Invokes the real deployed ingestBayEvents Lambda directly with SQS-batch-shaped payloads
// (the exact shape the SQS event source hands it), ramping concurrency from ~10 to ~80 req/s
// against two reserved-concurrency configs, and records real p95 latency for each.
const { LambdaClient, InvokeCommand, PutFunctionConcurrencyCommand } = require('@aws-sdk/client-lambda');
const { SQSClient, GetQueueAttributesCommand } = require('@aws-sdk/client-sqs');
const { DynamoDBClient, ScanCommand } = require('@aws-sdk/client-dynamodb');

const ENDPOINT = process.env.AWS_ENDPOINT_URL || 'http://localhost:4566';
const REGION = process.env.AWS_REGION || 'eu-west-1';
const CREDS = { accessKeyId: 'test', secretAccessKey: 'test' };
const FN_NAME = 'parkfog-ingest-bay-events';
const QUEUE_URL = process.env.PARKFOG_QUEUE_URL || 'http://localhost:4566/000000000000/parkfog-bay-events-queue';
const TABLE_NAME = 'parkfog-events-table';

// floci is a shared single container also serving other projects' tests; a handful of retries
// with short backoff absorbs transient ECONNRESET/socket hiccups instead of aborting the run
const lambdaClient = new LambdaClient({ endpoint: ENDPOINT, region: REGION, credentials: CREDS, maxAttempts: 5 });
const sqsClient = new SQSClient({ endpoint: ENDPOINT, region: REGION, credentials: CREDS });
const ddbClient = new DynamoDBClient({ endpoint: ENDPOINT, region: REGION, credentials: CREDS });

// req/s ramp levels the brief asked for: ~10 to ~80 (override with PARKFOG_LOAD_RAMP for a quick smoke run)
const RAMP_LEVELS = process.env.PARKFOG_LOAD_RAMP
  ? process.env.PARKFOG_LOAD_RAMP.split(',').map(Number)
  : [10, 20, 40, 60, 80];

function buildPayload(i) {
  return {
    Records: [
      {
        messageId: `load-${Date.now()}-${i}`,
        body: JSON.stringify({
          type: 'bay_state_event',
          bayId: `bay-load-${i % 6}`,
          state: i % 2 === 0 ? 'OCCUPIED' : 'FREE',
          fusedVote: 0.9,
          disabledBayViolation: false,
          timestamp: new Date().toISOString(),
        }),
      },
    ],
  };
}

async function invokeOne(i) {
  const start = Date.now();
  try {
    const res = await lambdaClient.send(new InvokeCommand({
      FunctionName: FN_NAME,
      Payload: Buffer.from(JSON.stringify(buildPayload(i))),
    }));
    const elapsedMs = Date.now() - start;
    const throttled = res.StatusCode === 429;
    const handlerError = !!res.FunctionError;
    return { ok: !throttled && !handlerError, throttled, handlerError, elapsedMs };
  } catch (err) {
    const elapsedMs = Date.now() - start;
    const throttled = err.name === 'TooManyRequestsException';
    return { ok: false, throttled, handlerError: false, elapsedMs, error: err.name };
  }
}

// launches invocations on a fixed-rate timer for LEVEL_DURATION_SEC without waiting for prior
// ones to finish, so multiple invocations genuinely overlap -- that overlap is what exercises
// the Lambda's reserved-concurrency cap; a wait-for-previous loop never would
const LEVEL_DURATION_SEC = Number(process.env.PARKFOG_LOAD_DURATION_SEC || 1.5);

async function runLevel(ratePerSec) {
  const totalRequests = ratePerSec * LEVEL_DURATION_SEC;
  const intervalMs = 1000 / ratePerSec;
  const inFlight = [];
  for (let i = 0; i < totalRequests; i++) {
    inFlight.push(invokeOne(i));
    // eslint-disable-next-line no-await-in-loop
    await new Promise((r) => setTimeout(r, intervalMs));
  }
  return Promise.all(inFlight);
}

function percentile(sortedArr, p) {
  if (sortedArr.length === 0) return null;
  const idx = Math.ceil((p / 100) * sortedArr.length) - 1;
  return sortedArr[Math.max(0, Math.min(idx, sortedArr.length - 1))];
}

function summarize(results) {
  const oks = results.filter((r) => r.ok);
  const throttledCount = results.filter((r) => r.throttled).length;
  const errorCount = results.filter((r) => !r.ok && !r.throttled).length;
  const latencies = oks.map((r) => r.elapsedMs).sort((a, b) => a - b);
  return {
    total: results.length,
    ok: oks.length,
    throttled: throttledCount,
    errors: errorCount,
    p50: percentile(latencies, 50),
    p95: percentile(latencies, 95),
    p99: percentile(latencies, 99),
    max: latencies.length ? latencies[latencies.length - 1] : null,
    min: latencies.length ? latencies[0] : null,
  };
}

async function setReservedConcurrency(value) {
  await lambdaClient.send(new PutFunctionConcurrencyCommand({
    FunctionName: FN_NAME,
    ReservedConcurrentExecutions: value,
  }));
  // let floci settle the concurrency change before hammering it
  await new Promise((r) => setTimeout(r, 2000));
}

async function getQueueDepth() {
  try {
    const res = await sqsClient.send(new GetQueueAttributesCommand({
      QueueUrl: QUEUE_URL,
      AttributeNames: ['ApproximateNumberOfMessages', 'ApproximateNumberOfMessagesNotVisible'],
    }));
    return res.Attributes;
  } catch (err) {
    return { error: err.message };
  }
}

async function getStoredCount() {
  try {
    const res = await ddbClient.send(new ScanCommand({
      TableName: TABLE_NAME,
      FilterExpression: 'entityId = :c',
      ExpressionAttributeValues: { ':c': { S: '__parkfog_counters__' } },
    }));
    const item = res.Items && res.Items[0];
    return item ? { receivedCount: item.receivedCount && item.receivedCount.N, storedCount: item.storedCount && item.storedCount.N } : null;
  } catch (err) {
    return { error: err.message };
  }
}

async function runConfig(reservedConcurrency) {
  console.log(`\n=== reserved concurrency = ${reservedConcurrency} ===`);
  await setReservedConcurrency(reservedConcurrency);

  const levelSummaries = [];
  for (const rate of RAMP_LEVELS) {
    const startedAt = new Date().toISOString();
    let results;
    try {
      results = await runLevel(rate);
    } catch (err) {
      // a transient floci connection reset must not sink the whole config's ramp; record and move on
      console.log(`  rate=${rate}req/s  LEVEL FAILED: ${err.name || err.message}`);
      levelSummaries.push({ ratePerSec: rate, startedAt, finishedAt: new Date().toISOString(), levelError: err.name || err.message });
      // eslint-disable-next-line no-continue
      continue;
    }
    const summary = summarize(results);
    const finishedAt = new Date().toISOString();
    console.log(
      `  rate=${rate}req/s  ok=${summary.ok}/${summary.total}  throttled=${summary.throttled}  errors=${summary.errors}  ` +
      `p50=${summary.p50}ms  p95=${summary.p95}ms  p99=${summary.p99}ms  max=${summary.max}ms`
    );
    levelSummaries.push({ ratePerSec: rate, startedAt, finishedAt, ...summary });
    // brief pause between ramp levels so floci's container pool isn't saturated across levels
    await new Promise((r) => setTimeout(r, 500));
  }

  const queueDepth = await getQueueDepth();
  const counters = await getStoredCount();

  return { reservedConcurrency, levelSummaries, queueDepth, counters };
}

async function main() {
  console.log('ParkFog ingestBayEvents reserved-concurrency load test');
  console.log('target function:', FN_NAME);
  console.log('endpoint:', ENDPOINT);
  console.log('started:', new Date().toISOString());

  const configResults = [];
  for (const concurrency of [5, 20]) {
    const result = await runConfig(concurrency);
    configResults.push(result);
  }

  console.log('\n=== RAW JSON RESULTS ===');
  console.log(JSON.stringify({ finishedAt: new Date().toISOString(), configResults }, null, 2));
}

main().catch((err) => {
  console.error('load test failed', err);
  process.exit(1);
});
