'use strict';

const { mockClient } = require('aws-sdk-client-mock');
const { QueryCommand } = require('@aws-sdk/lib-dynamodb');
const { docClient } = require('../src/lib/dynamoClient');
const { handler } = require('../src/handlers/zoneStatusHandler');

const ddbMock = mockClient(docClient);

beforeEach(() => {
  ddbMock.reset();
});

describe('zoneStatusHandler', () => {
  test('returns 200 with flattened per-topic fields and latest alert when zone data exists', async () => {
    const READINGS_BY_PREFIX = {
      'temperature#': { zoneId: 'zone-1', sensorTimestamp: 'temperature#2026-07-02T10:00:00Z', value: 21.5, timestamp: '2026-07-02T10:00:00Z' },
      'humidity#': { zoneId: 'zone-1', sensorTimestamp: 'humidity#2026-07-02T09:58:00Z', value: 47, timestamp: '2026-07-02T09:58:00Z' },
      'co2#': { zoneId: 'zone-1', sensorTimestamp: 'co2#2026-07-02T09:59:00Z', value: 612, timestamp: '2026-07-02T09:59:00Z' },
    };

    ddbMock
      .on(QueryCommand)
      .callsFake((input) => {
        if (input.TableName === 'CampusPulseReadings') {
          const prefix = input.ExpressionAttributeValues[':topicPrefix'];
          const item = READINGS_BY_PREFIX[prefix];
          return Promise.resolve({ Items: item ? [item] : [] });
        }
        if (input.TableName === 'CampusPulseAlerts') {
          return Promise.resolve({
            Items: [
              {
                zoneId: 'zone-1',
                alertTimestamp: 'LOAD_ANOMALY#2026-07-02T09:55:00Z',
                severity: 'WARN',
              },
            ],
          });
        }
        return Promise.resolve({ Items: [] });
      });

    const result = await handler({ pathParameters: { zoneId: 'zone-1' } });

    expect(result.statusCode).toBe(200);
    expect(result.headers['Access-Control-Allow-Origin']).toBe('*');

    const body = JSON.parse(result.body);
    expect(body.zoneId).toBe('zone-1');
    expect(body.temperature).toBe(21.5);
    expect(body.humidity).toBe(47);
    expect(body.co2).toBe(612);
    expect(body.lightLux).toBeNull();
    expect(body.latestReading.value).toBe(21.5);
    expect(body.latestAlert.severity).toBe('WARN');
  });

  test('returns 404 when no reading or alert exists for the zone', async () => {
    ddbMock.on(QueryCommand).resolves({ Items: [] });

    const result = await handler({ pathParameters: { zoneId: 'zone-empty' } });

    expect(result.statusCode).toBe(404);
  });

  test('returns 400 when zoneId path parameter is missing', async () => {
    const result = await handler({ pathParameters: null });

    expect(result.statusCode).toBe(400);
  });
});
