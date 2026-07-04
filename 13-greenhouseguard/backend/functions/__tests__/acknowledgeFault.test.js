const { mockClient } = require('aws-sdk-client-mock');
const { DynamoDBDocumentClient, UpdateCommand } = require('@aws-sdk/lib-dynamodb');

process.env.GREENHOUSEGUARD_COMMAND_LEDGER_TABLE = 'greenhouseguard-command-ledger-table';
process.env.GREENHOUSEGUARD_FAULTS_TABLE = 'greenhouseguard-faults-table';

const { handler } = require('../acknowledgeFault/index');

const ddbMock = mockClient(DynamoDBDocumentClient);

beforeEach(() => {
  ddbMock.reset();
});

describe('acknowledgeFault handler', () => {
  test('issues an UpdateItem with the right key and returns the updated item', async () => {
    const updatedItem = {
      zoneId: 'zone-a',
      eventTypeTimestamp: 'fertigation_event#2026-07-02T09:00:00.000Z',
      acknowledged: true,
    };
    ddbMock.on(UpdateCommand).resolves({ Attributes: updatedItem });

    const event = {
      pathParameters: { zoneId: 'zone-a' },
      body: JSON.stringify({ eventTypeTimestamp: 'fertigation_event#2026-07-02T09:00:00.000Z' }),
    };

    const result = await handler(event);

    expect(result.statusCode).toBe(200);
    expect(JSON.parse(result.body)).toEqual(updatedItem);

    const calls = ddbMock.commandCalls(UpdateCommand);
    expect(calls).toHaveLength(1);
    expect(calls[0].args[0].input).toMatchObject({
      TableName: 'greenhouseguard-faults-table',
      Key: {
        zoneId: 'zone-a',
        eventTypeTimestamp: 'fertigation_event#2026-07-02T09:00:00.000Z',
      },
    });
    expect(calls[0].args[0].input.ExpressionAttributeValues).toEqual({ ':acknowledged': true });
  });
});
