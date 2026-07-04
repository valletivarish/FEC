const { mockClient } = require('aws-sdk-client-mock');
const { DynamoDBDocumentClient, PutCommand, UpdateCommand } = require('@aws-sdk/lib-dynamodb');

process.env.GREENHOUSEGUARD_COMMAND_LEDGER_TABLE = 'greenhouseguard-command-ledger-table';
process.env.GREENHOUSEGUARD_FAULTS_TABLE = 'greenhouseguard-faults-table';

const { handler } = require('../ingestEvent/index');

const ddbMock = mockClient(DynamoDBDocumentClient);

beforeEach(() => {
  ddbMock.reset();
  ddbMock.on(UpdateCommand).resolves({});
});

function sqsRecord(body) {
  return { body: JSON.stringify(body) };
}

describe('ingestEvent handler', () => {
  test('routes setpoint_command to the command-ledger table', async () => {
    ddbMock.on(PutCommand).resolves({});

    const event = {
      Records: [
        sqsRecord({
          type: 'setpoint_command',
          zoneId: 'zone-a',
          ventPositionSetpoint: 42,
          vpdKpa: 1.1,
          timestamp: '2026-07-02T10:00:00.000Z',
        }),
      ],
    };

    await handler(event);

    const calls = ddbMock.commandCalls(PutCommand);
    expect(calls).toHaveLength(1);
    expect(calls[0].args[0].input).toEqual({
      TableName: 'greenhouseguard-command-ledger-table',
      Item: {
        zoneId: 'zone-a',
        timestamp: '2026-07-02T10:00:00.000Z',
        type: 'setpoint_command',
        ventPositionSetpoint: 42,
        vpdKpa: 1.1,
      },
    });
  });

  test('routes every other event type to the faults table with composite sort key and acknowledged: false', async () => {
    ddbMock.on(PutCommand).resolves({});

    const event = {
      Records: [
        sqsRecord({
          type: 'fertigation_event',
          zoneId: 'zone-b',
          metric: 'ec',
          severity: 'CRITICAL',
          value: 4.2,
          slopePerReading: null,
          doseDirection: null,
          lowMoisture: false,
          timestamp: '2026-07-02T11:00:00.000Z',
        }),
      ],
    };

    await handler(event);

    const calls = ddbMock.commandCalls(PutCommand);
    expect(calls).toHaveLength(1);
    expect(calls[0].args[0].input).toMatchObject({
      TableName: 'greenhouseguard-faults-table',
      Item: {
        zoneId: 'zone-b',
        eventTypeTimestamp: 'fertigation_event#2026-07-02T11:00:00.000Z',
        acknowledged: false,
        type: 'fertigation_event',
      },
    });
  });

  test.each([
    'enclosure_fault_event',
    'enclosure_breach_event',
    'dli_event',
  ])('routes %s events to the faults table', async (type) => {
    ddbMock.on(PutCommand).resolves({});

    await handler({
      Records: [
        sqsRecord({ type, zoneId: 'zone-c', timestamp: '2026-07-02T12:00:00.000Z' }),
      ],
    });

    const calls = ddbMock.commandCalls(PutCommand);
    expect(calls[0].args[0].input.TableName).toBe('greenhouseguard-faults-table');
    expect(calls[0].args[0].input.Item.eventTypeTimestamp).toBe(`${type}#2026-07-02T12:00:00.000Z`);
  });

  test('does not throw on a malformed record and continues processing the rest of the batch', async () => {
    ddbMock.on(PutCommand).resolves({});

    const event = {
      Records: [
        { body: '{not valid json' },
        sqsRecord({
          type: 'setpoint_command',
          zoneId: 'zone-a',
          ventPositionSetpoint: 60,
          vpdKpa: 0.9,
          timestamp: '2026-07-02T13:00:00.000Z',
        }),
      ],
    };

    await expect(handler(event)).resolves.not.toThrow();

    const calls = ddbMock.commandCalls(PutCommand);
    expect(calls).toHaveLength(1);
    expect(calls[0].args[0].input.TableName).toBe('greenhouseguard-command-ledger-table');

    // the malformed record must not bump the received counter, only the one real record does
    const counterCalls = ddbMock.commandCalls(UpdateCommand);
    const receivedBumps = counterCalls.filter((c) => c.args[0].input.UpdateExpression === 'ADD messagesReceived :one');
    expect(receivedBumps).toHaveLength(1);
  });

  test('bumps a real messagesReceived and messagesStored counter on the shared faults table for every persisted record', async () => {
    ddbMock.on(PutCommand).resolves({});

    await handler({
      Records: [
        sqsRecord({
          type: 'setpoint_command',
          zoneId: 'zone-a',
          ventPositionSetpoint: 42,
          vpdKpa: 1.1,
          timestamp: '2026-07-02T10:00:00.000Z',
        }),
      ],
    });

    const counterCalls = ddbMock.commandCalls(UpdateCommand);
    expect(counterCalls).toHaveLength(2);
    expect(counterCalls[0].args[0].input).toMatchObject({
      TableName: 'greenhouseguard-faults-table',
      Key: { zoneId: '__counters__', eventTypeTimestamp: 'system_message_counters' },
      UpdateExpression: 'ADD messagesReceived :one',
    });
    expect(counterCalls[1].args[0].input.UpdateExpression).toBe('ADD messagesStored :one');
  });
});
