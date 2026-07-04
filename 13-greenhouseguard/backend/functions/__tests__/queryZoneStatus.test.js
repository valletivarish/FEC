const { mockClient } = require('aws-sdk-client-mock');
const { DynamoDBDocumentClient, QueryCommand } = require('@aws-sdk/lib-dynamodb');

process.env.GREENHOUSEGUARD_COMMAND_LEDGER_TABLE = 'greenhouseguard-command-ledger-table';
process.env.GREENHOUSEGUARD_FAULTS_TABLE = 'greenhouseguard-faults-table';

const { handler } = require('../queryZoneStatus/index');

const ddbMock = mockClient(DynamoDBDocumentClient);

beforeEach(() => {
  ddbMock.reset();
});

describe('queryZoneStatus handler', () => {
  test('returns a well-formed 200 response combining latest command and fault list', async () => {
    const latestCommand = {
      zoneId: 'zone-a',
      timestamp: '2026-07-02T10:00:00.000Z',
      type: 'setpoint_command',
      ventPositionSetpoint: 42,
    };
    const faults = [
      { zoneId: 'zone-a', eventTypeTimestamp: 'fertigation_event#2026-07-02T09:00:00.000Z', acknowledged: false },
      { zoneId: 'zone-a', eventTypeTimestamp: 'enclosure_fault_event#2026-07-02T09:30:00.000Z', acknowledged: true },
    ];

    ddbMock
      .on(QueryCommand, { TableName: 'greenhouseguard-command-ledger-table' })
      .resolves({ Items: [latestCommand] });
    ddbMock
      .on(QueryCommand, { TableName: 'greenhouseguard-faults-table' })
      .resolves({ Items: faults });

    const event = { pathParameters: { zoneId: 'zone-a' } };
    const result = await handler(event);

    expect(result.statusCode).toBe(200);
    expect(JSON.parse(result.body)).toEqual({
      zoneId: 'zone-a',
      latestCommand,
      faults,
    });

    const commandCall = ddbMock.commandCalls(QueryCommand, { TableName: 'greenhouseguard-command-ledger-table' })[0];
    expect(commandCall.args[0].input.ScanIndexForward).toBe(false);
    expect(commandCall.args[0].input.Limit).toBe(1);
  });

  test('returns null latestCommand when no command exists yet', async () => {
    ddbMock
      .on(QueryCommand, { TableName: 'greenhouseguard-command-ledger-table' })
      .resolves({ Items: [] });
    ddbMock
      .on(QueryCommand, { TableName: 'greenhouseguard-faults-table' })
      .resolves({ Items: [] });

    const result = await handler({ pathParameters: { zoneId: 'zone-b' } });

    expect(JSON.parse(result.body)).toEqual({
      zoneId: 'zone-b',
      latestCommand: null,
      faults: [],
    });
  });
});
