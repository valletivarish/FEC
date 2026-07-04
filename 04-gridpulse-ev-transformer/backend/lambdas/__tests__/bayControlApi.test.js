const { DynamoDBDocumentClient, QueryCommand } = require('@aws-sdk/lib-dynamodb');
const { mockClient } = require('aws-sdk-client-mock');

process.env.GRIDPULSE_READINGS_TABLE = 'GridPulseHubSensorReadings';
process.env.GRIDPULSE_CURTAILMENT_TABLE = 'GridPulseCurtailmentEvents';

const { handler } = require('../bayControlApi/index');

const ddbMock = mockClient(DynamoDBDocumentClient);

beforeEach(() => {
  ddbMock.reset();
});

describe('bayControlApi handler', () => {
  test('returns 400 when hubId path parameter is missing', async () => {
    const result = await handler({ pathParameters: {} });
    expect(result.statusCode).toBe(400);
  });

  test('returns a well-formed 200 with the latest setpoint per bay', async () => {
    ddbMock.on(QueryCommand).resolves({
      Items: [
        {
          type: 'bay_setpoint', hubId: 'hub-01', bayId: 'bay-01', setpointAmps: 32, timestamp: '2026-07-02T10:00:00.000Z',
        },
        {
          type: 'bay_setpoint', hubId: 'hub-01', bayId: 'bay-01', setpointAmps: 20, timestamp: '2026-07-02T10:05:00.000Z',
        },
      ],
    });

    const result = await handler({ pathParameters: { hubId: 'hub-01' } });

    expect(result.statusCode).toBe(200);
    const body = JSON.parse(result.body);
    expect(body).toHaveLength(1);
    expect(body[0].bayId).toBe('bay-01');
    expect(body[0].setpointAmps).toBe(20);

    const call = ddbMock.commandCalls(QueryCommand)[0];
    expect(call.args[0].input.TableName).toBe('GridPulseHubSensorReadings');
    expect(call.args[0].input.ExpressionAttributeValues[':prefix']).toBe('bay_setpoint#');
  });

  test('returns empty array when no setpoint records exist', async () => {
    ddbMock.on(QueryCommand).resolves({ Items: [] });

    const result = await handler({ pathParameters: { hubId: 'hub-03' } });

    expect(result.statusCode).toBe(200);
    const body = JSON.parse(result.body);
    expect(body).toEqual([]);
  });
});
