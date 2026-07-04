'use strict';

process.env.OFFICEIQ_READINGS_TABLE = 'OfficeIQReadings';
process.env.OFFICEIQ_EVENT_QUEUE_URL = 'http://localhost:4566/000000000000/officeiq-event-queue';

const { DynamoDBClient, DescribeTableCommand } = require('@aws-sdk/client-dynamodb');
const { DynamoDBDocumentClient, GetCommand, ScanCommand } = require('@aws-sdk/lib-dynamodb');
const { SQSClient, GetQueueAttributesCommand } = require('@aws-sdk/client-sqs');
const { mockClient } = require('aws-sdk-client-mock');
const { handler } = require('../api/handlers/getSystemStatus');

const ddbMock = mockClient(DynamoDBClient);
const docMock = mockClient(DynamoDBDocumentClient);
const sqsMock = mockClient(SQSClient);

beforeEach(() => {
  ddbMock.reset();
  docMock.reset();
  sqsMock.reset();
});

describe('getSystemStatus handler', () => {
  test('reports Connected/Online everywhere when every real check succeeds', async () => {
    ddbMock.on(DescribeTableCommand).resolves({ Table: { TableStatus: 'ACTIVE' } });
    sqsMock.on(GetQueueAttributesCommand).resolves({ Attributes: { ApproximateNumberOfMessages: '4' } });
    docMock.on(GetCommand).resolves({ Item: { messagesReceived: 128 } });
    docMock.on(ScanCommand).resolves({ Count: 96 });

    const response = await handler();

    expect(response.statusCode).toBe(200);
    const body = JSON.parse(response.body);
    expect(body.apiStatus).toBe('Online');
    expect(body.serverStatus).toBe('Online');
    expect(body.cloudConnection).toBe('Connected');
    expect(body.database).toEqual({ status: 'Connected', tableStatus: 'ACTIVE' });
    expect(body.queue).toEqual({ status: 'Connected', approximateNumberOfMessages: 4 });
    expect(body.messagesReceived).toBe(128);
    expect(body.messagesStored).toBe(96);
  });

  test('reports Unavailable database and Unreachable cloud connection when DescribeTable fails', async () => {
    ddbMock.on(DescribeTableCommand).rejects(new Error('ResourceNotFoundException'));
    sqsMock.on(GetQueueAttributesCommand).resolves({ Attributes: { ApproximateNumberOfMessages: '0' } });
    docMock.on(GetCommand).resolves({ Item: undefined });
    docMock.on(ScanCommand).resolves({ Count: 0 });

    const response = await handler();

    const body = JSON.parse(response.body);
    expect(body.database.status).toBe('Unavailable');
    expect(body.cloudConnection).toBe('Unreachable');
  });

  test('reports Unavailable queue when GetQueueAttributes fails', async () => {
    ddbMock.on(DescribeTableCommand).resolves({ Table: { TableStatus: 'ACTIVE' } });
    sqsMock.on(GetQueueAttributesCommand).rejects(new Error('QueueDoesNotExist'));
    docMock.on(GetCommand).resolves({ Item: undefined });
    docMock.on(ScanCommand).resolves({ Count: 0 });

    const response = await handler();

    const body = JSON.parse(response.body);
    expect(body.queue).toEqual({ status: 'Unavailable', approximateNumberOfMessages: null });
    expect(body.cloudConnection).toBe('Unreachable');
  });

  test('defaults messagesReceived to 0 when no counters row exists yet', async () => {
    ddbMock.on(DescribeTableCommand).resolves({ Table: { TableStatus: 'ACTIVE' } });
    sqsMock.on(GetQueueAttributesCommand).resolves({ Attributes: { ApproximateNumberOfMessages: '0' } });
    docMock.on(GetCommand).resolves({});
    docMock.on(ScanCommand).resolves({ Count: 0 });

    const response = await handler();

    const body = JSON.parse(response.body);
    expect(body.messagesReceived).toBe(0);
  });

  test('paginates the messages-stored scan across multiple pages and sums real counts', async () => {
    ddbMock.on(DescribeTableCommand).resolves({ Table: { TableStatus: 'ACTIVE' } });
    sqsMock.on(GetQueueAttributesCommand).resolves({ Attributes: { ApproximateNumberOfMessages: '0' } });
    docMock.on(GetCommand).resolves({ Item: { messagesReceived: 10 } });
    docMock.on(ScanCommand)
      .resolvesOnce({ Count: 50, LastEvaluatedKey: { zoneId: 'zone-101' } })
      .resolvesOnce({ Count: 30 });

    const response = await handler();

    const body = JSON.parse(response.body);
    expect(body.messagesStored).toBe(80);
  });
});
