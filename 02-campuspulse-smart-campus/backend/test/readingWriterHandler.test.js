'use strict';

const { mockClient } = require('aws-sdk-client-mock');
const { PutCommand } = require('@aws-sdk/lib-dynamodb');
const { docClient } = require('../src/lib/dynamoClient');
const { handler } = require('../src/handlers/readingWriterHandler');

const ddbMock = mockClient(docClient);

beforeEach(() => {
  ddbMock.reset();
});

function sqsRecord(body, messageId = 'msg-1') {
  return { messageId, body: JSON.stringify(body) };
}

describe('readingWriterHandler', () => {
  test('writes a raw reading batch to the readings table', async () => {
    ddbMock.on(PutCommand).resolves({});

    const readings = [
      { zoneId: 'zone-1', topic: 'temperature', value: 21.5, timestamp: '2026-07-02T10:00:00Z' },
    ];

    await handler({ Records: [sqsRecord(readings)] });

    const calls = ddbMock.commandCalls(PutCommand);
    expect(calls).toHaveLength(1);
    expect(calls[0].args[0].input.TableName).toBe('CampusPulseReadings');
    expect(calls[0].args[0].input.Item.sensorTimestamp).toBe('temperature#2026-07-02T10:00:00Z');
  });

  test('writes a WARN/BREACH fog event to the alerts table', async () => {
    ddbMock.on(PutCommand).resolves({});

    const fogEvent = {
      zoneId: 'zone-2',
      eventType: 'LEAK_SUSPECTED',
      severity: 'BREACH',
      payload: { flowRate: 12.4 },
      timestamp: '2026-07-02T10:05:00Z',
    };

    await handler({ Records: [sqsRecord(fogEvent)] });

    const calls = ddbMock.commandCalls(PutCommand);
    expect(calls).toHaveLength(1);
    expect(calls[0].args[0].input.TableName).toBe('CampusPulseAlerts');
    expect(calls[0].args[0].input.Item.alertTimestamp).toBe(
      'LEAK_SUSPECTED#2026-07-02T10:05:00Z'
    );
    expect(calls[0].args[0].input.Item.expiresAt).toBeGreaterThan(Math.floor(Date.now() / 1000));
  });

  test('skips persisting an INFO fog event', async () => {
    ddbMock.on(PutCommand).resolves({});

    const fogEvent = {
      zoneId: 'zone-3',
      eventType: 'COMFORT_OK',
      severity: 'INFO',
      payload: {},
      timestamp: '2026-07-02T10:10:00Z',
    };

    await handler({ Records: [sqsRecord(fogEvent)] });

    expect(ddbMock.commandCalls(PutCommand)).toHaveLength(0);
  });

  test('a malformed record does not throw and does not block other records', async () => {
    ddbMock.on(PutCommand).resolves({});

    const goodReading = [
      { zoneId: 'zone-4', topic: 'humidity', value: 45, timestamp: '2026-07-02T10:15:00Z' },
    ];

    const malformedRecord = { messageId: 'msg-bad', body: '{not valid json' };
    const goodRecord = sqsRecord(goodReading, 'msg-good');

    await expect(
      handler({ Records: [malformedRecord, goodRecord] })
    ).resolves.toEqual({ batchItemFailures: [] });

    expect(ddbMock.commandCalls(PutCommand)).toHaveLength(1);
  });
});
