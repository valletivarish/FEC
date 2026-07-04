// Proves the API-Gateway relay Lambda actually reaches SQS - unlike sensorToFogToBackend.test.js,
// this drives the handler with a proxy-shaped event and reads the message back off the real queue.
const {
  SQSClient,
  CreateQueueCommand,
  ReceiveMessageCommand,
  PurgeQueueCommand,
} = require('@aws-sdk/client-sqs');

const QUEUE_NAME = 'officeiq-event-queue-relay-test';

const sqsClient = new SQSClient({});

let queueUrl;

beforeAll(async () => {
  const created = await sqsClient.send(new CreateQueueCommand({ QueueName: QUEUE_NAME }));
  queueUrl = created.QueueUrl;
  process.env.OFFICEIQ_EVENT_QUEUE_URL = queueUrl;

  try {
    await sqsClient.send(new PurgeQueueCommand({ QueueUrl: queueUrl }));
  } catch {
    // a fresh queue has nothing to purge; floci still allows the call to fail this way
  }
});

test('a POST-shaped invocation of the relay handler lands the raw body on the real SQS queue', async () => {
  const { handler } = require('../backend/api/handlers/postEvent');

  const rawBody = JSON.stringify({
    type: 'comfort_event',
    zoneId: 'zone-it-relay-01',
    verdict: 'VENTILATION_ANOMALY',
    severity: 'critical',
    timestamp: '2026-07-03T10:00:00.000Z',
  });

  const apiGatewayProxyEvent = {
    version: '2.0',
    routeKey: 'POST /events',
    rawPath: '/events',
    headers: { 'content-type': 'application/json' },
    requestContext: { http: { method: 'POST', path: '/events' } },
    body: rawBody,
    isBase64Encoded: false,
  };

  const response = await handler(apiGatewayProxyEvent);
  expect(response.statusCode).toBe(202);

  const received = await sqsClient.send(new ReceiveMessageCommand({
    QueueUrl: queueUrl,
    MaxNumberOfMessages: 1,
    WaitTimeSeconds: 5,
  }));

  expect(received.Messages).toHaveLength(1);
  expect(received.Messages[0].Body).toBe(rawBody);
  expect(JSON.parse(received.Messages[0].Body)).toMatchObject({
    zoneId: 'zone-it-relay-01',
    verdict: 'VENTILATION_ANOMALY',
  });
});
