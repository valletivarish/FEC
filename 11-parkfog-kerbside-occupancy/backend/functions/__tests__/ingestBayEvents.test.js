const { mockClient } = require('aws-sdk-client-mock');
const { PutCommand } = require('@aws-sdk/lib-dynamodb');
const { docClient } = require('../../lib/dynamoClient');
const { handler } = require('../ingestBayEvents/index');

const ddbMock = mockClient(docClient);

beforeEach(() => {
  ddbMock.reset();
  ddbMock.on(PutCommand).resolves({});
});

function sqsRecord(body, messageId = 'msg-1') {
  return { messageId, body: JSON.stringify(body) };
}

describe('ingestBayEvents handler', () => {
  test('routes bay_state_event with bayId as partition key', async () => {
    const timestamp = '2026-07-02T10:00:00.000Z';
    await handler({
      Records: [
        sqsRecord({
          type: 'bay_state_event',
          bayId: 'bay-01',
          state: 'OCCUPIED',
          fusedVote: 0.75,
          disabledBayViolation: false,
          timestamp,
        }),
      ],
    });

    const calls = ddbMock.commandCalls(PutCommand);
    expect(calls).toHaveLength(1);
    expect(calls[0].args[0].input.Item).toMatchObject({
      entityId: 'bay-01',
      eventTypeTimestamp: `bay_state_event#${timestamp}`,
    });
  });

  test('routes overstay_event with bayId as partition key', async () => {
    const timestamp = '2026-07-02T10:01:00.000Z';
    await handler({
      Records: [
        sqsRecord({
          type: 'overstay_event',
          bayId: 'bay-02',
          purchasedMinutesRemaining: 0,
          anprConfidence: 40,
          timestamp,
        }),
      ],
    });

    const item = ddbMock.commandCalls(PutCommand)[0].args[0].input.Item;
    expect(item.entityId).toBe('bay-02');
    expect(item.eventTypeTimestamp).toBe(`overstay_event#${timestamp}`);
  });

  test('routes zone_pressure_event with zoneId fallback partition key', async () => {
    const timestamp = '2026-07-02T10:02:00.000Z';
    await handler({
      Records: [
        sqsRecord({
          type: 'zone_pressure_event',
          zoneId: 'zone-01',
          entryPressureEwma: 3.2,
          timestamp,
        }),
      ],
    });

    const item = ddbMock.commandCalls(PutCommand)[0].args[0].input.Item;
    expect(item.entityId).toBe('zone-01');
    expect(item.eventTypeTimestamp).toBe(`zone_pressure_event#${timestamp}`);
  });

  test('routes flood_risk_event with zoneId fallback partition key', async () => {
    const timestamp = '2026-07-02T10:03:00.000Z';
    await handler({
      Records: [
        sqsRecord({
          type: 'flood_risk_event',
          zoneId: 'zone-01',
          band: 'caution',
          averageFloodLevel: 80,
          timestamp,
        }),
      ],
    });

    const item = ddbMock.commandCalls(PutCommand)[0].args[0].input.Item;
    expect(item.entityId).toBe('zone-01');
    expect(item.eventTypeTimestamp).toBe(`flood_risk_event#${timestamp}`);
  });

  test('routes ev_fault_event with bayId as partition key', async () => {
    const timestamp = '2026-07-02T10:04:00.000Z';
    await handler({
      Records: [
        sqsRecord({
          type: 'ev_fault_event',
          bayId: 'bay-06',
          timestamp,
        }),
      ],
    });

    const item = ddbMock.commandCalls(PutCommand)[0].args[0].input.Item;
    expect(item.entityId).toBe('bay-06');
    expect(item.eventTypeTimestamp).toBe(`ev_fault_event#${timestamp}`);
  });

  test('prefers bayId over zoneId when both are present', async () => {
    const timestamp = '2026-07-02T10:05:00.000Z';
    await handler({
      Records: [
        sqsRecord({
          type: 'bay_state_event',
          bayId: 'bay-03',
          zoneId: 'zone-01',
          timestamp,
        }),
      ],
    });

    const item = ddbMock.commandCalls(PutCommand)[0].args[0].input.Item;
    expect(item.entityId).toBe('bay-03');
  });

  test('does not throw on a malformed record and still processes the rest of the batch', async () => {
    const timestamp = '2026-07-02T10:06:00.000Z';
    const badRecord = { messageId: 'bad-1', body: '{not valid json' };
    const goodRecord = sqsRecord(
      { type: 'bay_state_event', bayId: 'bay-04', timestamp },
      'good-1'
    );

    await expect(
      handler({ Records: [badRecord, goodRecord] })
    ).resolves.not.toThrow();

    const calls = ddbMock.commandCalls(PutCommand);
    expect(calls).toHaveLength(1);
    expect(calls[0].args[0].input.Item.entityId).toBe('bay-04');
  });

  test('does not throw when an event is missing entityId/type/timestamp', async () => {
    const badEvent = sqsRecord({ foo: 'bar' }, 'bad-2');
    const goodEvent = sqsRecord(
      { type: 'bay_state_event', bayId: 'bay-05', timestamp: '2026-07-02T10:07:00.000Z' },
      'good-2'
    );

    await expect(
      handler({ Records: [badEvent, goodEvent] })
    ).resolves.not.toThrow();

    const calls = ddbMock.commandCalls(PutCommand);
    expect(calls).toHaveLength(1);
    expect(calls[0].args[0].input.Item.entityId).toBe('bay-05');
  });

  test('handles an empty Records array without error', async () => {
    await expect(handler({ Records: [] })).resolves.toEqual({ batchItemFailures: [] });
    expect(ddbMock.commandCalls(PutCommand)).toHaveLength(0);
  });
});
