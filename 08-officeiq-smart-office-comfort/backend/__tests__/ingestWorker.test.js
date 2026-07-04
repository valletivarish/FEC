'use strict';

process.env.OFFICEIQ_READINGS_TABLE = 'OfficeIQReadings';

const { DynamoDBDocumentClient, PutCommand, UpdateCommand } = require('@aws-sdk/lib-dynamodb');
const { mockClient } = require('aws-sdk-client-mock');
const { processMessage, SYSTEM_COUNTERS_ZONE_ID, SYSTEM_COUNTERS_SORT_KEY } = require('../worker/ingestWorker');

const ddbMock = mockClient(DynamoDBDocumentClient);

beforeEach(() => {
  ddbMock.reset();
  // every processMessage call also bumps the real received-message counter used by getSystemStatus
  ddbMock.on(UpdateCommand).resolves({});
});

describe('processMessage', () => {
  test('writes an occupancy_event with the correct composite sort key', async () => {
    ddbMock.on(PutCommand).resolves({});

    const event = {
      type: 'occupancy_event',
      zoneId: 'zone-101',
      verdict: 'SENSOR_DRIFT',
      deskOccupiedCount: 5,
      netPeopleCount: 1,
      resolvedHeadcount: 3,
      timestamp: '2026-07-02T10:00:00.000Z',
    };

    await processMessage(event);

    const calls = ddbMock.commandCalls(PutCommand);
    expect(calls).toHaveLength(1);
    expect(calls[0].args[0].input).toEqual({
      TableName: 'OfficeIQReadings',
      Item: {
        zoneId: 'zone-101',
        eventTypeTimestamp: 'occupancy_event#2026-07-02T10:00:00.000Z',
        ...event,
      },
    });
  });

  test('writes a comfort_event with the correct composite sort key', async () => {
    ddbMock.on(PutCommand).resolves({});

    const event = {
      type: 'comfort_event',
      zoneId: 'zone-102',
      verdict: 'VENTILATION_ANOMALY',
      severity: 'critical',
      co2Slope: 22.5,
      pressureDifferential: 2,
      timestamp: '2026-07-02T10:05:00.000Z',
    };

    await processMessage(event);

    const calls = ddbMock.commandCalls(PutCommand);
    expect(calls).toHaveLength(1);
    expect(calls[0].args[0].input.Item.eventTypeTimestamp).toBe(
      'comfort_event#2026-07-02T10:05:00.000Z'
    );
    expect(calls[0].args[0].input.Item.zoneId).toBe('zone-102');
  });

  test('writes a usage_event with the correct composite sort key', async () => {
    ddbMock.on(PutCommand).resolves({});

    const event = {
      type: 'usage_event',
      zoneId: 'zone-201',
      verdict: 'DEVICE_LEFT_ON',
      estimatedWattHoursWasted: 12.3,
      timestamp: '2026-07-02T10:10:00.000Z',
    };

    await processMessage(event);

    const calls = ddbMock.commandCalls(PutCommand);
    expect(calls).toHaveLength(1);
    const input = calls[0].args[0].input;
    expect(input.TableName).toBe('OfficeIQReadings');
    expect(input.Item.eventTypeTimestamp).toBe('usage_event#2026-07-02T10:10:00.000Z');
    expect(input.Item).toMatchObject(event);
  });

  test('returns the written item', async () => {
    ddbMock.on(PutCommand).resolves({});

    const event = {
      type: 'usage_event',
      zoneId: 'zone-202',
      verdict: 'DEVICE_LEFT_ON_ESCALATED',
      estimatedWattHoursWasted: 40,
      timestamp: '2026-07-02T10:15:00.000Z',
    };

    const written = await processMessage(event);

    expect(written.eventTypeTimestamp).toBe('usage_event#2026-07-02T10:15:00.000Z');
  });

  test('increments the real system received-message counter on every processed message', async () => {
    ddbMock.on(PutCommand).resolves({});

    await processMessage({
      type: 'comfort_event',
      zoneId: 'zone-101',
      verdict: 'PRESSURE_FAULT',
      timestamp: '2026-07-02T10:20:00.000Z',
    });

    const updateCalls = ddbMock.commandCalls(UpdateCommand);
    expect(updateCalls).toHaveLength(1);
    expect(updateCalls[0].args[0].input).toEqual({
      TableName: 'OfficeIQReadings',
      Key: { zoneId: SYSTEM_COUNTERS_ZONE_ID, eventTypeTimestamp: SYSTEM_COUNTERS_SORT_KEY },
      UpdateExpression: 'ADD messagesReceived :one',
      ExpressionAttributeValues: { ':one': 1 },
    });
  });
});
