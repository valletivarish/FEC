const { DynamoDBDocumentClient, PutCommand, UpdateCommand } = require('@aws-sdk/lib-dynamodb');
const { mockClient } = require('aws-sdk-client-mock');

process.env.GRIDPULSE_READINGS_TABLE = 'GridPulseHubSensorReadings';
process.env.GRIDPULSE_CURTAILMENT_TABLE = 'GridPulseCurtailmentEvents';
process.env.GRIDPULSE_OPS_COUNTERS_TABLE = 'GridPulseOpsCounters';

const { handler } = require('../ingestHubTelemetry/index');

const ddbMock = mockClient(DynamoDBDocumentClient);

function kinesisRecord(eventObj) {
  return {
    kinesis: {
      data: Buffer.from(JSON.stringify(eventObj)).toString('base64'),
    },
  };
}

beforeEach(() => {
  ddbMock.reset();
  ddbMock.on(UpdateCommand).resolves({});
});

describe('ingestHubTelemetry handler', () => {
  test('routes bay_setpoint event to readings table', async () => {
    ddbMock.on(PutCommand).resolves({});
    const event = {
      type: 'bay_setpoint',
      hubId: 'hub-01',
      bayId: 'bay-01',
      setpointAmps: 32,
      timestamp: '2026-07-02T10:00:00.000Z',
    };

    await handler({ Records: [kinesisRecord(event)] });

    const calls = ddbMock.commandCalls(PutCommand);
    expect(calls).toHaveLength(1);
    expect(calls[0].args[0].input.TableName).toBe('GridPulseHubSensorReadings');
    expect(calls[0].args[0].input.Item['metricType#timestamp']).toBe('bay_setpoint#2026-07-02T10:00:00.000Z');
  });

  test('bumps received/stored ops counters by an atomic ADD after a successful batch', async () => {
    ddbMock.on(PutCommand).resolves({});
    const event = {
      type: 'bay_setpoint', hubId: 'hub-01', bayId: 'bay-01', setpointAmps: 32, timestamp: '2026-07-02T10:00:00.000Z',
    };

    await handler({ Records: [kinesisRecord(event)] });

    const updateCalls = ddbMock.commandCalls(UpdateCommand);
    expect(updateCalls).toHaveLength(1);
    expect(updateCalls[0].args[0].input.TableName).toBe('GridPulseOpsCounters');
    expect(updateCalls[0].args[0].input.ExpressionAttributeValues).toEqual({ ':received': 1, ':stored': 1 });
  });

  test('counts a record as received but not stored when its type is unrecognized', async () => {
    ddbMock.on(PutCommand).resolves({});
    const event = { type: 'unknown_event', hubId: 'hub-01', timestamp: '2026-07-02T10:00:00.000Z' };

    await handler({ Records: [kinesisRecord(event)] });

    const updateCalls = ddbMock.commandCalls(UpdateCommand);
    expect(updateCalls[0].args[0].input.ExpressionAttributeValues).toEqual({ ':received': 1, ':stored': 0 });
  });

  test('does not call UpdateCommand when the batch has no records', async () => {
    await handler({ Records: [] });
    expect(ddbMock.commandCalls(UpdateCommand)).toHaveLength(0);
  });

  test('routes der_mode and der_summary events to readings table', async () => {
    ddbMock.on(PutCommand).resolves({});
    const modeEvent = {
      type: 'der_mode',
      hubId: 'hub-01',
      mode: 'charge_battery_from_solar',
      solarKw: 5,
      batterySoc: 40,
      tariffPrice: 12,
      timestamp: '2026-07-02T10:01:00.000Z',
    };
    const summaryEvent = {
      type: 'der_summary',
      hubId: 'hub-01',
      mode: 'idle',
      solarKw: 1,
      batterySoc: 41,
      tariffPrice: 13,
      timestamp: '2026-07-02T10:02:00.000Z',
    };

    await handler({ Records: [kinesisRecord(modeEvent), kinesisRecord(summaryEvent)] });

    const calls = ddbMock.commandCalls(PutCommand);
    expect(calls).toHaveLength(2);
    expect(calls[0].args[0].input.TableName).toBe('GridPulseHubSensorReadings');
    expect(calls[1].args[0].input.TableName).toBe('GridPulseHubSensorReadings');
  });

  test('routes feeder_status event to readings table', async () => {
    ddbMock.on(PutCommand).resolves({});
    const event = {
      type: 'feeder_status',
      hubId: 'hub-01',
      status: 'warning',
      voltage: 239,
      frequency: 50,
      timestamp: '2026-07-02T10:05:00.000Z',
    };

    await handler({ Records: [kinesisRecord(event)] });

    const calls = ddbMock.commandCalls(PutCommand);
    expect(calls).toHaveLength(1);
    expect(calls[0].args[0].input.TableName).toBe('GridPulseHubSensorReadings');
    expect(calls[0].args[0].input.Item['metricType#timestamp']).toBe('feeder_status#2026-07-02T10:05:00.000Z');
  });

  test('routes curtailment_event to curtailment table', async () => {
    ddbMock.on(PutCommand).resolves({});
    const event = {
      type: 'curtailment_event',
      hubId: 'hub-01',
      rung: 1,
      rungLabel: 'advisory',
      reason: 'load 320-360A',
      shedBayId: null,
      timestamp: '2026-07-02T10:03:00.000Z',
    };

    await handler({ Records: [kinesisRecord(event)] });

    const calls = ddbMock.commandCalls(PutCommand);
    expect(calls).toHaveLength(1);
    expect(calls[0].args[0].input.TableName).toBe('GridPulseCurtailmentEvents');
    expect(calls[0].args[0].input.Item.timestamp).toBe('2026-07-02T10:03:00.000Z');
  });

  test('does not throw on a malformed record and continues processing the rest of the batch', async () => {
    ddbMock.on(PutCommand).resolves({});
    const malformedRecord = { kinesis: { data: Buffer.from('not-json').toString('base64') } };
    const goodEvent = {
      type: 'bay_setpoint',
      hubId: 'hub-01',
      bayId: 'bay-02',
      setpointAmps: 16,
      timestamp: '2026-07-02T10:04:00.000Z',
    };

    await expect(handler({ Records: [malformedRecord, kinesisRecord(goodEvent)] })).resolves.toBeDefined();

    const calls = ddbMock.commandCalls(PutCommand);
    expect(calls).toHaveLength(1);
    expect(calls[0].args[0].input.Item.bayId).toBe('bay-02');
  });

  test('handles an empty Records array without throwing', async () => {
    await expect(handler({ Records: [] })).resolves.toBeDefined();
    expect(ddbMock.commandCalls(PutCommand)).toHaveLength(0);
  });
});
