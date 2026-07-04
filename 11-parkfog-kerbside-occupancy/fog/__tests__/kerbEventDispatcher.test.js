const { KerbEventDispatcher } = require('../shared/kerbEventDispatcher');

class FakeKerbEventDispatcher extends KerbEventDispatcher {
  constructor(apiBaseUrl) {
    super(apiBaseUrl);
    this.dispatchedEvents = [];
  }

  async dispatch(event) {
    this.dispatchedEvents.push(event);
    return true;
  }
}

describe('KerbEventDispatcher', () => {
  test('is subclassable and overridable (no private fields blocking extension)', () => {
    const fake = new FakeKerbEventDispatcher('http://api.example.test');
    expect(fake).toBeInstanceOf(KerbEventDispatcher);
  });

  test('subclass dispatch captures the exact event shape passed in', async () => {
    const fake = new FakeKerbEventDispatcher('http://api.example.test');
    const event = { type: 'bay_state_event', bayId: 'bay-01', state: 'OCCUPIED', fusedVote: 0.8, disabledBayViolation: false, timestamp: 't1' };

    const result = await fake.dispatch(event);

    expect(result).toBe(true);
    expect(fake.dispatchedEvents).toEqual([event]);
  });

  test('posts to {apiBaseUrl}/events with the event JSON-encoded, using an injected session', async () => {
    const calls = [];
    const fakeSession = {
      fetch: async (url, options) => {
        calls.push({ url, options });
        return { ok: true };
      },
    };
    const dispatcher = new KerbEventDispatcher('http://api.example.test', fakeSession);
    const event = { type: 'flood_risk_event', zoneId: 'zone-01', band: 'caution', averageFloodLevel: 80, timestamp: 't1' };

    const result = await dispatcher.dispatch(event);

    expect(result).toBe(true);
    expect(calls).toHaveLength(1);
    expect(calls[0].url).toBe('http://api.example.test/events');
    expect(calls[0].options.method).toBe('POST');
    expect(JSON.parse(calls[0].options.body)).toEqual(event);
  });

  test('returns false and pushes to fallback on a non-2xx response', async () => {
    const fakeSession = { fetch: async () => ({ ok: false, status: 500 }) };
    const dispatcher = new KerbEventDispatcher('http://api.example.test', fakeSession);
    const event = { type: 'ev_fault_event', bayId: 'bay-06', timestamp: 't1' };

    const result = await dispatcher.dispatch(event);

    expect(result).toBe(false);
    expect(dispatcher.drainFallback()).toEqual([event]);
  });

  test('catches fetch errors, never throws, and falls back', async () => {
    const fakeSession = {
      fetch: async () => {
        throw new Error('network down');
      },
    };
    const dispatcher = new KerbEventDispatcher('http://api.example.test', fakeSession);
    const event = { type: 'overstay_event', bayId: 'bay-02', purchasedMinutesRemaining: 0, anprConfidence: 40, timestamp: 't1' };

    await expect(dispatcher.dispatch(event)).resolves.toBe(false);
    expect(dispatcher.drainFallback()).toEqual([event]);
  });

  test('drainFallback empties the fallback array after reading it', async () => {
    const fakeSession = { fetch: async () => ({ ok: false }) };
    const dispatcher = new KerbEventDispatcher('http://api.example.test', fakeSession);
    await dispatcher.dispatch({ type: 'zone_pressure_event', zoneId: 'zone-01', entryPressureEwma: 5, timestamp: 't1' });

    const firstDrain = dispatcher.drainFallback();
    const secondDrain = dispatcher.drainFallback();

    expect(firstDrain).toHaveLength(1);
    expect(secondDrain).toHaveLength(0);
  });
});
