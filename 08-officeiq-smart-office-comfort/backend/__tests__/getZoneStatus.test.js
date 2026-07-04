'use strict';

process.env.OFFICEIQ_READINGS_TABLE = 'OfficeIQReadings';
process.env.OFFICEIQ_WORKER_DESIRED_COUNT = '3';
process.env.OFFICEIQ_WORKER_RUNNING_COUNT = '2';

const { DynamoDBDocumentClient, QueryCommand } = require('@aws-sdk/lib-dynamodb');
const { mockClient } = require('aws-sdk-client-mock');
const { handler } = require('../api/handlers/getZoneStatus');

const ddbMock = mockClient(DynamoDBDocumentClient);

beforeEach(() => {
  ddbMock.reset();
});

// mirrors the worker's own write path: zoneId partition key, "type#timestamp" sort key
function mockEventsByType(occupancy, comfort, usage) {
  ddbMock.on(QueryCommand).callsFake((input) => {
    const prefix = input.ExpressionAttributeValues[':typePrefix'];
    if (prefix === 'occupancy_event#') return Promise.resolve({ Items: occupancy || [] });
    if (prefix === 'comfort_event#') return Promise.resolve({ Items: comfort || [] });
    if (prefix === 'usage_event#') return Promise.resolve({ Items: usage || [] });
    return Promise.resolve({ Items: [] });
  });
}

describe('getZoneStatus handler', () => {
  test('returns real context fields derived from each event type\'s latest item', async () => {
    const occupancyEvent = {
      zoneId: 'zone-101',
      eventTypeTimestamp: 'occupancy_event#2026-07-02T10:00:00.000Z',
      type: 'occupancy_event',
      verdict: 'STANDING_ROOM',
      deskOccupiedCount: 4,
      netPeopleCount: 7,
      resolvedHeadcount: 6,
      timestamp: '2026-07-02T10:00:00.000Z',
    };
    const comfortEvent = {
      zoneId: 'zone-101',
      eventTypeTimestamp: 'comfort_event#2026-07-02T10:05:00.000Z',
      type: 'comfort_event',
      verdict: 'VENTILATION_ANOMALY',
      severity: 'critical',
      co2Slope: 20,
      roomCo2: 1100,
      temperature: 23.5,
      humidity: 55,
      windowState: 0,
      noiseLevel: 42,
      pressureDifferential: 2,
      timestamp: '2026-07-02T10:05:00.000Z',
    };
    const usageEvent = {
      zoneId: 'zone-101',
      eventTypeTimestamp: 'usage_event#2026-07-02T10:10:00.000Z',
      type: 'usage_event',
      verdict: 'DEVICE_LEFT_ON',
      estimatedWattHoursWasted: 12.5,
      plugPower: 45,
      lightLevel: 620,
      timestamp: '2026-07-02T10:10:00.000Z',
    };

    mockEventsByType([occupancyEvent], [comfortEvent], [usageEvent]);

    const response = await handler({ pathParameters: { zoneId: 'zone-101' } });

    expect(response.statusCode).toBe(200);
    const body = JSON.parse(response.body);
    expect(body.zoneId).toBe('zone-101');
    expect(body.deskOccupancy).toBe(4);
    expect(body.roomCo2).toBe(1100);
    expect(body.roomTemperature).toBe(23.5);
    expect(body.status).toBe('critical');
    expect(body.occupancyEvents).toEqual([occupancyEvent]);
    expect(body.comfortEvents).toEqual([comfortEvent]);
    expect(body.usageEvents).toEqual([usageEvent]);
    expect(body.scalingStatus).toEqual({ desiredCount: 3, runningCount: 2 });
  });

  test('a PRESSURE_FAULT latest comfort event forces status to critical regardless of severity field', async () => {
    const comfortEvent = {
      zoneId: 'zone-101',
      type: 'comfort_event',
      verdict: 'PRESSURE_FAULT',
      severity: null,
      roomCo2: null,
      temperature: null,
      timestamp: '2026-07-02T10:05:00.000Z',
    };
    mockEventsByType([], [comfortEvent], []);

    const response = await handler({ pathParameters: { zoneId: 'zone-101' } });

    const body = JSON.parse(response.body);
    expect(body.status).toBe('critical');
  });

  test('returns empty lists and nominal status when no events exist for the zone', async () => {
    mockEventsByType([], [], []);

    const response = await handler({ pathParameters: { zoneId: 'zone-202' } });

    expect(response.statusCode).toBe(200);
    const body = JSON.parse(response.body);
    expect(body.occupancyEvents).toEqual([]);
    expect(body.comfortEvents).toEqual([]);
    expect(body.usageEvents).toEqual([]);
    expect(body.deskOccupancy).toBeNull();
    expect(body.roomCo2).toBeNull();
    expect(body.roomTemperature).toBeNull();
    expect(body.status).toBe('nominal');
  });

  test('returns 400 when zoneId is missing', async () => {
    const response = await handler({ pathParameters: {} });

    expect(response.statusCode).toBe(400);
  });
});
