'use strict';

process.env.OFFICEIQ_EVENT_QUEUE_URL = 'http://localhost:4566/000000000000/officeiq-event-queue';

const { SQSClient, SendMessageCommand } = require('@aws-sdk/client-sqs');
const { mockClient } = require('aws-sdk-client-mock');
const { handler } = require('../api/handlers/postEvent');

const sqsMock = mockClient(SQSClient);

beforeEach(() => {
  sqsMock.reset();
});

describe('postEvent handler', () => {
  test('relays the raw request body onto the event queue unmodified', async () => {
    sqsMock.on(SendMessageCommand).resolves({ MessageId: '1' });

    const rawBody = JSON.stringify({ type: 'comfort_event', zoneId: 'zone-101', verdict: 'VENTILATION_ANOMALY' });
    const response = await handler({ body: rawBody });

    expect(response.statusCode).toBe(202);
    const calls = sqsMock.commandCalls(SendMessageCommand);
    expect(calls).toHaveLength(1);
    expect(calls[0].args[0].input).toEqual({
      QueueUrl: 'http://localhost:4566/000000000000/officeiq-event-queue',
      MessageBody: rawBody,
    });
  });
});
