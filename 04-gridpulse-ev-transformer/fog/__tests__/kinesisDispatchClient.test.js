const { KinesisDispatchClient } = require('../shared/kinesisDispatchClient');
const { FakeDispatchClient } = require('./testUtils/fakeDispatchClient');

describe('KinesisDispatchClient', () => {
  test('sends a PutRecordCommand with JSON-stringified Buffer data and hubId partition key', async () => {
    const sentCommands = [];
    const fakeKinesisClient = { send: async (command) => { sentCommands.push(command); return {}; } };
    const client = new KinesisDispatchClient(fakeKinesisClient, 'my-stream');

    const event = { type: 'der_mode', hubId: 'hub-01', mode: 'idle', timestamp: '2026-01-01T00:00:00.000Z' };
    const result = await client.dispatch(event);

    expect(result).toBe(true);
    expect(sentCommands).toHaveLength(1);
    const input = sentCommands[0].input;
    expect(input.StreamName).toBe('my-stream');
    expect(input.PartitionKey).toBe('hub-01');
    expect(Buffer.isBuffer(input.Data)).toBe(true);
    expect(JSON.parse(input.Data.toString())).toEqual(event);
  });

  test('returns false and does not throw when the send call fails', async () => {
    const failingKinesisClient = { send: async () => { throw new Error('network down'); } };
    const client = new KinesisDispatchClient(failingKinesisClient, 'my-stream');
    const result = await client.dispatch({ type: 'der_mode', hubId: 'hub-01' });
    expect(result).toBe(false);
  });

  test('is subclassable and the subclass can override dispatch for test capture', async () => {
    const fake = new FakeDispatchClient();
    const event = { type: 'curtailment_event', hubId: 'hub-01', rung: 1 };
    const result = await fake.dispatch(event);
    expect(result).toBe(true);
    expect(fake.dispatched).toEqual([event]);
  });
});
