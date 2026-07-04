'use strict';

const { mockClient } = require('aws-sdk-client-mock');
const { QueryCommand } = require('@aws-sdk/lib-dynamodb');
const { docClient } = require('../src/lib/dynamoClient');
const { handler } = require('../src/handlers/zoneHistoryHandler');

const ddbMock = mockClient(docClient);

beforeEach(() => {
  ddbMock.reset();
});

describe('zoneHistoryHandler', () => {
  test('rejects a request with no zoneId path parameter', async () => {
    const result = await handler({ pathParameters: null });
    expect(result.statusCode).toBe(400);
  });

  test('returns readings and events queried in parallel from both tables', async () => {
    ddbMock
      .on(QueryCommand, { TableName: 'CampusPulseReadings' })
      .resolves({ Items: [{ zoneId: 'zone-1', topic: 'electricity', value: 4.2, timestamp: '2026-07-02T10:00:00Z' }] });
    ddbMock
      .on(QueryCommand, { TableName: 'CampusPulseAlerts' })
      .resolves({ Items: [{ zoneId: 'zone-1', eventType: 'LOAD_ANOMALY', severity: 'BREACH', timestamp: '2026-07-02T10:01:00Z' }] });

    const result = await handler({ pathParameters: { zoneId: 'zone-1' } });

    expect(result.statusCode).toBe(200);
    const body = JSON.parse(result.body);
    expect(body.readings).toHaveLength(1);
    expect(body.events).toHaveLength(1);
    expect(body.events[0].eventType).toBe('LOAD_ANOMALY');
  });

  test('returns an empty events array when the zone has no alerts', async () => {
    ddbMock.on(QueryCommand, { TableName: 'CampusPulseReadings' }).resolves({ Items: [] });
    ddbMock.on(QueryCommand, { TableName: 'CampusPulseAlerts' }).resolves({ Items: [] });

    const result = await handler({ pathParameters: { zoneId: 'zone-2' } });

    const body = JSON.parse(result.body);
    expect(body.readings).toEqual([]);
    expect(body.events).toEqual([]);
  });

  test('applies the topic filter only to the readings query, not the alerts query', async () => {
    ddbMock.on(QueryCommand, { TableName: 'CampusPulseReadings' }).resolves({ Items: [] });
    ddbMock.on(QueryCommand, { TableName: 'CampusPulseAlerts' }).resolves({ Items: [] });

    await handler({ pathParameters: { zoneId: 'zone-3' }, queryStringParameters: { topic: 'water-flow' } });

    const readingsCall = ddbMock.commandCalls(QueryCommand, { TableName: 'CampusPulseReadings' })[0];
    expect(readingsCall.args[0].input.KeyConditionExpression).toContain('begins_with');
    expect(readingsCall.args[0].input.ExpressionAttributeValues[':topicPrefix']).toBe('water-flow#');

    const alertsCall = ddbMock.commandCalls(QueryCommand, { TableName: 'CampusPulseAlerts' })[0];
    expect(alertsCall.args[0].input.KeyConditionExpression).not.toContain('begins_with');
  });

  test('returns a 500 when the alerts query fails', async () => {
    ddbMock.on(QueryCommand, { TableName: 'CampusPulseReadings' }).resolves({ Items: [] });
    ddbMock.on(QueryCommand, { TableName: 'CampusPulseAlerts' }).rejects(new Error('boom'));

    const result = await handler({ pathParameters: { zoneId: 'zone-4' } });
    expect(result.statusCode).toBe(500);
  });
});
