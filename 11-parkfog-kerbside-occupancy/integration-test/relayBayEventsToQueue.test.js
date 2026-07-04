// Proves the API-Gateway-facing relay actually lands a message on SQS, closing the gap
// left by sensorToFogToBackend.test.js which calls ingestBayEvents in-process and never
// exercises the HTTP POST -> relay -> queue hop the fog dispatcher depends on.
const { SQSClient, CreateQueueCommand, ReceiveMessageCommand, PurgeQueueCommand } = require('@aws-sdk/client-sqs');

const QUEUE_NAME = 'parkfog-relay-it-queue';

const sqsClient = new SQSClient({});
let queueUrl;

async function ensureQueue() {
  const result = await sqsClient.send(new CreateQueueCommand({ QueueName: QUEUE_NAME }));
  return result.QueueUrl;
}

beforeAll(async () => {
  queueUrl = await ensureQueue();
  process.env.PARKFOG_BAY_EVENTS_QUEUE_URL = queueUrl;
  await sqsClient.send(new PurgeQueueCommand({ QueueUrl: queueUrl })).catch(() => {});
});

test('an API-Gateway-shaped POST /events invocation relays the raw body onto the real SQS queue', async () => {
  // required after queueUrl is known, so the handler picks up the env var set in beforeAll
  const { handler } = require('../backend/functions/relayBayEvents');

  const fogEvent = {
    type: 'bay_state_event',
    bayId: 'bay-it-relay-01',
    state: 'OCCUPIED',
    fusedVote: 0.9,
    disabledBayViolation: false,
    timestamp: '2026-07-03T09:00:00.000Z',
  };
  const apiGatewayEvent = {
    version: '2.0',
    routeKey: 'POST /events',
    rawPath: '/events',
    headers: { 'content-type': 'application/json' },
    requestContext: { http: { method: 'POST', path: '/events' } },
    body: JSON.stringify(fogEvent),
    isBase64Encoded: false,
  };

  const result = await handler(apiGatewayEvent);
  expect(result.statusCode).toBe(202);

  const received = await sqsClient.send(new ReceiveMessageCommand({
    QueueUrl: queueUrl,
    MaxNumberOfMessages: 1,
    WaitTimeSeconds: 5,
  }));

  expect(received.Messages).toHaveLength(1);
  expect(JSON.parse(received.Messages[0].Body)).toEqual(fogEvent);
});
