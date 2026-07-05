const { DynamoDBDocumentClient, QueryCommand } = require('@aws-sdk/lib-dynamodb');
const { mockClient } = require('aws-sdk-client-mock');

process.env.GRIDPULSE_READINGS_TABLE = 'GridPulseHubSensorReadings';
process.env.GRIDPULSE_CURTAILMENT_TABLE = 'GridPulseCurtailmentEvents';

const { handler } = require('../hubSummaryApi/index');

const ddbMock = mockClient(DynamoDBDocumentClient);

beforeEach(() => {
  ddbMock.reset();
});

describe('hubSummaryApi handler', () => {
  test('returns 400 when hubId path parameter is missing', async () => {
    const result = await handler({ pathParameters: {} });
    expect(result.statusCode).toBe(400);
  });

  test('returns a well-formed 200 with latest per-bay state and hub-level DER/curtailment state', async () => {
    ddbMock
      .on(QueryCommand, { TableName: 'GridPulseHubSensorReadings' })
      .resolves({
        Items: [
          {
            type: 'bay_setpoint', hubId: 'hub-01', bayId: 'bay-01', setpointAmps: 32, timestamp: '2026-07-02T10:00:00.000Z',
          },
          {
            type: 'bay_setpoint', hubId: 'hub-01', bayId: 'bay-01', setpointAmps: 20, timestamp: '2026-07-02T10:05:00.000Z',
          },
          {
            type: 'bay_setpoint', hubId: 'hub-01', bayId: 'bay-02', setpointAmps: 16, timestamp: '2026-07-02T10:01:00.000Z',
          },
          {
            type: 'der_mode', hubId: 'hub-01', mode: 'idle', solarKw: 1, batterySoc: 50, tariffPrice: 10, timestamp: '2026-07-02T10:02:00.000Z',
          },
          {
            type: 'der_summary', hubId: 'hub-01', mode: 'idle', solarKw: 2, batterySoc: 51, tariffPrice: 11, timestamp: '2026-07-02T10:06:00.000Z',
          },
          {
            type: 'feeder_status', hubId: 'hub-01', status: 'warning', voltage: 239, frequency: 50, timestamp: '2026-07-02T10:04:00.000Z',
          },
          {
            type: 'feeder_status', hubId: 'hub-01', status: 'nominal', voltage: 230, frequency: 50, timestamp: '2026-07-02T10:07:00.000Z',
          },
        ],
      });
    ddbMock
      .on(QueryCommand, { TableName: 'GridPulseCurtailmentEvents' })
      .resolves({
        Items: [
          {
            hubId: 'hub-01', rung: 1, rungLabel: 'advisory', reason: 'load', shedBayId: null, timestamp: '2026-07-02T09:59:00.000Z',
          },
        ],
      });

    const result = await handler({ pathParameters: { hubId: 'hub-01' } });

    expect(result.statusCode).toBe(200);
    const body = JSON.parse(result.body);
    expect(body.hubId).toBe('hub-01');
    expect(body.bays).toHaveLength(2);
    const bay01 = body.bays.find((b) => b.bayId === 'bay-01');
    expect(bay01.setpointAmps).toBe(20);
    expect(body.der.timestamp).toBe('2026-07-02T10:06:00.000Z');
    expect(body.feeder.timestamp).toBe('2026-07-02T10:07:00.000Z');
    expect(body.feeder.status).toBe('nominal');
    expect(body.curtailment.rungLabel).toBe('advisory');
  });

  test('returns null der, feeder and curtailment when none exist', async () => {
    ddbMock.on(QueryCommand, { TableName: 'GridPulseHubSensorReadings' }).resolves({ Items: [] });
    ddbMock.on(QueryCommand, { TableName: 'GridPulseCurtailmentEvents' }).resolves({ Items: [] });

    const result = await handler({ pathParameters: { hubId: 'hub-02' } });

    expect(result.statusCode).toBe(200);
    const body = JSON.parse(result.body);
    expect(body.bays).toEqual([]);
    expect(body.der).toBeNull();
    expect(body.feeder).toBeNull();
    expect(body.curtailment).toBeNull();
  });
});
