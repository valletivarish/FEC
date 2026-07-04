const { DynamoDBClient, DescribeTableCommand } = require('@aws-sdk/client-dynamodb');
const { DynamoDBDocumentClient, GetCommand, ScanCommand } = require('@aws-sdk/lib-dynamodb');
const { KinesisClient, DescribeStreamSummaryCommand } = require('@aws-sdk/client-kinesis');
const { mockClient } = require('aws-sdk-client-mock');

process.env.GRIDPULSE_READINGS_TABLE = 'GridPulseHubSensorReadings';
process.env.GRIDPULSE_CURTAILMENT_TABLE = 'GridPulseCurtailmentEvents';
process.env.GRIDPULSE_OPS_COUNTERS_TABLE = 'GridPulseOpsCounters';
process.env.GRIDPULSE_STREAM_NAME = 'gridpulse-telemetry-stream';

const { handler } = require('../healthApi/index');

const ddbMock = mockClient(DynamoDBClient);
const docMock = mockClient(DynamoDBDocumentClient);
const kinesisMock = mockClient(KinesisClient);

beforeEach(() => {
  ddbMock.reset();
  docMock.reset();
  kinesisMock.reset();
});

describe('healthApi handler', () => {
  test('reports connected/reachable when every real check succeeds', async () => {
    ddbMock.on(DescribeTableCommand).resolves({ Table: { TableStatus: 'ACTIVE' } });
    kinesisMock.on(DescribeStreamSummaryCommand).resolves({ StreamDescriptionSummary: { StreamStatus: 'ACTIVE' } });
    docMock.on(GetCommand).resolves({ Item: { counterId: 'gridpulse-backend', messagesReceived: 42, messagesStored: 40 } });
    docMock.on(ScanCommand).resolves({ Count: 40, LastEvaluatedKey: undefined });

    const result = await handler();

    expect(result.statusCode).toBe(200);
    const body = JSON.parse(result.body);
    expect(body.apiStatus).toBe('reachable');
    expect(body.database).toBe('connected');
    expect(body.queue).toBe('connected');
    expect(body.cloudConnection).toBe('connected');
    expect(body.server).toBe('running');
    expect(body.messagesReceived).toBe(42);
    expect(body.messagesStored).toBe(40);
  });

  test('reports unavailable/unreachable when DescribeTable fails', async () => {
    ddbMock.on(DescribeTableCommand).rejects(new Error('connect ECONNREFUSED'));
    kinesisMock.on(DescribeStreamSummaryCommand).resolves({ StreamDescriptionSummary: { StreamStatus: 'ACTIVE' } });
    docMock.on(GetCommand).resolves({});
    docMock.on(ScanCommand).rejects(new Error('table missing'));

    const result = await handler();

    const body = JSON.parse(result.body);
    expect(body.database).toBe('unavailable');
    expect(body.cloudConnection).toBe('unreachable');
    expect(body.messagesReceived).toBe(0);
  });

  test('reports queue unavailable when the Kinesis stream check fails', async () => {
    ddbMock.on(DescribeTableCommand).resolves({ Table: { TableStatus: 'ACTIVE' } });
    kinesisMock.on(DescribeStreamSummaryCommand).rejects(new Error('stream not found'));
    docMock.on(GetCommand).resolves({ Item: { messagesReceived: 5, messagesStored: 5 } });
    docMock.on(ScanCommand).resolves({ Count: 5 });

    const result = await handler();

    const body = JSON.parse(result.body);
    expect(body.queue).toBe('unavailable');
    expect(body.cloudConnection).toBe('unreachable');
    expect(body.database).toBe('connected');
  });

  test('paginates the readings scan across multiple pages to reach an accurate count', async () => {
    ddbMock.on(DescribeTableCommand).resolves({ Table: { TableStatus: 'ACTIVE' } });
    kinesisMock.on(DescribeStreamSummaryCommand).resolves({ StreamDescriptionSummary: { StreamStatus: 'ACTIVE' } });
    docMock.on(GetCommand).resolves({ Item: { messagesReceived: 100, messagesStored: 75 } });
    docMock.on(ScanCommand)
      .resolvesOnce({ Count: 50, LastEvaluatedKey: { hubId: 'hub-01' } })
      .resolvesOnce({ Count: 25, LastEvaluatedKey: undefined });

    const result = await handler();

    const body = JSON.parse(result.body);
    expect(body.messagesStored).toBe(75);
    expect(docMock.commandCalls(ScanCommand)).toHaveLength(2);
  });
});
