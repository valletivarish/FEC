const { GreenhouseEventDispatcher } = require('../shared/greenhouseEventDispatcher');

describe('GreenhouseEventDispatcher', () => {
  test('returns true and POSTs to {apiBaseUrl}/events on a 2xx response', async () => {
    const calls = [];
    const session = {
      fetch: async (url, options) => {
        calls.push({ url, options });
        return { ok: true, status: 200 };
      },
    };
    const dispatcher = new GreenhouseEventDispatcher('https://api.example.com', session);
    const event = { type: 'setpoint_command', zoneId: 'zone-a' };

    const result = await dispatcher.dispatch(event);

    expect(result).toBe(true);
    expect(calls).toHaveLength(1);
    expect(calls[0].url).toBe('https://api.example.com/events');
    expect(JSON.parse(calls[0].options.body)).toEqual(event);
  });

  test('returns false and stores to fallback on a non-2xx response', async () => {
    const session = { fetch: async () => ({ ok: false, status: 500 }) };
    const dispatcher = new GreenhouseEventDispatcher('https://api.example.com', session);
    const event = { type: 'fertigation_event', zoneId: 'zone-b' };

    const result = await dispatcher.dispatch(event);

    expect(result).toBe(false);
    expect(dispatcher.drainFallback()).toEqual([event]);
  });

  test('catches fetch errors, never throws, and stores to fallback', async () => {
    const session = { fetch: async () => { throw new Error('network down'); } };
    const dispatcher = new GreenhouseEventDispatcher('https://api.example.com', session);
    const event = { type: 'enclosure_fault_event', zoneId: 'zone-c' };

    await expect(dispatcher.dispatch(event)).resolves.toBe(false);
    expect(dispatcher.drainFallback()).toEqual([event]);
  });

  test('drainFallback empties the fallback array', async () => {
    const session = { fetch: async () => ({ ok: false }) };
    const dispatcher = new GreenhouseEventDispatcher('https://api.example.com', session);
    await dispatcher.dispatch({ type: 'dli_event' });

    expect(dispatcher.drainFallback()).toHaveLength(1);
    expect(dispatcher.drainFallback()).toHaveLength(0);
  });

  test('is subclassable with no private fields blocking extension', async () => {
    const dispatched = [];
    class FakeDispatcher extends GreenhouseEventDispatcher {
      async dispatch(event) {
        dispatched.push(event);
        return true;
      }
    }
    const fake = new FakeDispatcher('https://api.example.com');
    const event = { type: 'enclosure_breach_event', zoneId: 'zone-a' };
    const result = await fake.dispatch(event);

    expect(result).toBe(true);
    expect(dispatched).toEqual([event]);
  });
});
