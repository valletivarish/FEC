const { mockClient } = require('aws-sdk-client-mock');
const { DynamoDBClient, DescribeTableCommand } = require('@aws-sdk/client-dynamodb');
const { DynamoDBDocumentClient, GetCommand, ScanCommand } = require('@aws-sdk/lib-dynamodb');
const { SQSClient, GetQueueAttributesCommand } = require('@aws-sdk/client-sqs');

process.env.GREENHOUSEGUARD_COMMAND_LEDGER_TABLE = 'greenhouseguard-command-ledger-table';
process.env.GREENHOUSEGUARD_FAULTS_TABLE = 'greenhouseguard-faults-table';
process.env.GREENHOUSEGUARD_INGEST_QUEUE_URL = 'https://sqs.eu-west-1.amazonaws.com/000/greenhouseguard-ingest-queue';

const { handler } = require('../systemStatus/index');

const ddbMock = mockClient(DynamoDBClient);
const docMock = mockClient(DynamoDBDocumentClient);
const sqsMock = mockClient(SQSClient);

beforeEach(() => {
  ddbMock.reset();
  docMock.reset();
  sqsMock.reset();
});

describe('systemStatus handler', () => {
  test('reports everything healthy when DynamoDB DescribeTable, SQS and counters all succeed', async () => {
    ddbMock.on(DescribeTableCommand).resolves({ Table: { TableStatus: 'ACTIVE' } });
    sqsMock.on(GetQueueAttributesCommand).resolves({ Attributes: { ApproximateNumberOfMessages: '3' } });
    docMock.on(GetCommand).resolves({ Item: { messagesReceived: 42, messagesStored: 40 } });
    docMock.on(ScanCommand).resolves({ Count: 41 });

    const result = await handler();
    const body = JSON.parse(result.body);

    expect(result.statusCode).toBe(200);
    expect(body.databaseStatus).toBe('Connected');
    expect(body.queueStatus).toBe('Connected');
    expect(body.queueApproxMessages).toBe(3);
    expect(body.cloudConnectionStatus).toBe('Connected');
    expect(body.apiStatus).toBe('Online');
    expect(body.serverStatus).toBe('Online');
    expect(body.messagesReceived).toBe(42);
    // storedItemCount wins over the raw counter when the scan succeeds (41 items minus the counters row = 40)
    expect(body.messagesStored).toBe(40);
  });

  test('reports database Unavailable when a DescribeTable call throws', async () => {
    ddbMock.on(DescribeTableCommand).rejects(new Error('connection refused'));
    sqsMock.on(GetQueueAttributesCommand).resolves({ Attributes: { ApproximateNumberOfMessages: '0' } });
    docMock.on(GetCommand).resolves({ Item: undefined });
    docMock.on(ScanCommand).resolves({ Count: 0 });

    const result = await handler();
    const body = JSON.parse(result.body);

    expect(body.databaseStatus).toBe('Unavailable');
    expect(body.cloudConnectionStatus).toBe('Unreachable');
  });

  test('reports queue Unreachable when GetQueueAttributes throws', async () => {
    ddbMock.on(DescribeTableCommand).resolves({ Table: { TableStatus: 'ACTIVE' } });
    sqsMock.on(GetQueueAttributesCommand).rejects(new Error('queue not found'));
    docMock.on(GetCommand).resolves({ Item: undefined });
    docMock.on(ScanCommand).resolves({ Count: 0 });

    const result = await handler();
    const body = JSON.parse(result.body);

    expect(body.queueStatus).toBe('Unreachable');
    expect(body.queueApproxMessages).toBeNull();
    expect(body.cloudConnectionStatus).toBe('Unreachable');
  });

  test('falls back to the raw counters item when the scan itself fails', async () => {
    ddbMock.on(DescribeTableCommand).resolves({ Table: { TableStatus: 'ACTIVE' } });
    sqsMock.on(GetQueueAttributesCommand).resolves({ Attributes: { ApproximateNumberOfMessages: '0' } });
    docMock.on(GetCommand).resolves({ Item: { messagesReceived: 10, messagesStored: 9 } });
    docMock.on(ScanCommand).rejects(new Error('scan failed'));

    const result = await handler();
    const body = JSON.parse(result.body);

    expect(body.messagesStored).toBe(9);
  });

  test('defaults counters to zero when no counters row exists yet', async () => {
    ddbMock.on(DescribeTableCommand).resolves({ Table: { TableStatus: 'ACTIVE' } });
    sqsMock.on(GetQueueAttributesCommand).resolves({ Attributes: { ApproximateNumberOfMessages: '0' } });
    docMock.on(GetCommand).resolves({ Item: undefined });
    docMock.on(ScanCommand).resolves({ Count: 0 });

    const result = await handler();
    const body = JSON.parse(result.body);

    expect(body.messagesReceived).toBe(0);
    expect(body.messagesStored).toBe(0);
  });
});
