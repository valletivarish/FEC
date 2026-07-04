// Proves the API-Gateway-facing gap is actually closed: a POST-shaped invocation of the relay
// handler must land the raw body on the real ingest queue, not just call the handler in-process.
const { SQSClient, CreateQueueCommand, ReceiveMessageCommand, DeleteQueueCommand } = require('@aws-sdk/client-sqs');

const QUEUE_NAME = 'greenhouseguard-ingest-queue-relay-it';

const sqsClient = new SQSClient({});

let queueUrl;

beforeAll(async () => {
  const created = await sqsClient.send(new CreateQueueCommand({ QueueName: QUEUE_NAME }));
  queueUrl = created.QueueUrl;
  process.env.GREENHOUSEGUARD_INGEST_QUEUE_URL = queueUrl;
});

afterAll(async () => {
  await sqsClient.send(new DeleteQueueCommand({ QueueUrl: queueUrl }));
});

test('relayIngestEvent forwards the raw POST body onto the real ingest queue', async () => {
  const { handler } = require('../backend/functions/relayIngestEvent');

  const event = {
    body: JSON.stringify({
      type: 'fertigation_event',
      zoneId: 'zone-relay-it',
      metric: 'ec',
      severity: 'CRITICAL',
      value: 4.2,
      timestamp: '2026-07-03T10:00:00.000Z',
    }),
  };

  const response = await handler(event);
  expect(response.statusCode).toBe(202);

  const received = await sqsClient.send(new ReceiveMessageCommand({
    QueueUrl: queueUrl,
    MaxNumberOfMessages: 1,
    WaitTimeSeconds: 5,
  }));

  expect(received.Messages).toHaveLength(1);
  const body = JSON.parse(received.Messages[0].Body);
  expect(body.type).toBe('fertigation_event');
  expect(body.zoneId).toBe('zone-relay-it');
  expect(body.severity).toBe('CRITICAL');
});
