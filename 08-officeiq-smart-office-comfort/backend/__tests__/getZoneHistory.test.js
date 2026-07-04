'use strict';

process.env.OFFICEIQ_READINGS_TABLE = 'OfficeIQReadings';

const { DynamoDBDocumentClient, QueryCommand } = require('@aws-sdk/lib-dynamodb');
const { mockClient } = require('aws-sdk-client-mock');
const { handler } = require('../api/handlers/getZoneHistory');

const ddbMock = mockClient(DynamoDBDocumentClient);

beforeEach(() => {
  ddbMock.reset();
});

describe('getZoneHistory handler', () => {
  test('returns a well-formed 200 with events shaped from query results', async () => {
    const items = [
      {
        zoneId: 'zone-101',
        eventTypeTimestamp: 'occupancy_event#2026-07-02T10:00:00.000Z',
        type: 'occupancy_event',
        verdict: 'STANDING_ROOM',
        timestamp: '2026-07-02T10:00:00.000Z',
      },
      {
        zoneId: 'zone-101',
        eventTypeTimestamp: 'occupancy_event#2026-07-02T09:55:00.000Z',
        type: 'occupancy_event',
        verdict: 'SENSOR_DRIFT',
        timestamp: '2026-07-02T09:55:00.000Z',
      },
    ];

    ddbMock.on(QueryCommand).resolves({ Items: items });

    const response = await handler({
      pathParameters: { zoneId: 'zone-101' },
      queryStringParameters: null,
    });

    expect(response.statusCode).toBe(200);
    const body = JSON.parse(response.body);
    expect(body.zoneId).toBe('zone-101');
    expect(body.count).toBe(2);
    expect(body.events).toEqual(items);
  });

  test('respects a custom limit query param', async () => {
    ddbMock.on(QueryCommand).resolves({ Items: [] });

    await handler({
      pathParameters: { zoneId: 'zone-102' },
      queryStringParameters: { limit: '5' },
    });

    const calls = ddbMock.commandCalls(QueryCommand);
    expect(calls[0].args[0].input.Limit).toBe(5);
  });

  test('returns 400 when zoneId is missing', async () => {
    const response = await handler({ pathParameters: {} });

    expect(response.statusCode).toBe(400);
  });
});
