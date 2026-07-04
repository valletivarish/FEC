'use strict';

const { ZoneEventDispatcher } = require('../shared/zoneEventDispatcher');

function fakeSession(response) {
  return { fetch: jest.fn().mockResolvedValue(response) };
}

describe('ZoneEventDispatcher', () => {
  test('returns true and posts to /events on a 2xx response', async () => {
    const session = fakeSession({ ok: true, status: 200 });
    const dispatcher = new ZoneEventDispatcher('http://api.local', session);

    const result = await dispatcher.dispatch({ type: 'occupancy_event' });

    expect(result).toBe(true);
    expect(session.fetch).toHaveBeenCalledWith(
      'http://api.local/events',
      expect.objectContaining({ method: 'POST' })
    );
    expect(dispatcher.drainFallback()).toEqual([]);
  });

  test('returns false and stores in fallback on non-2xx response', async () => {
    const session = fakeSession({ ok: false, status: 500 });
    const dispatcher = new ZoneEventDispatcher('http://api.local', session);

    const event = { type: 'comfort_event' };
    const result = await dispatcher.dispatch(event);

    expect(result).toBe(false);
    expect(dispatcher.drainFallback()).toEqual([event]);
  });

  test('catches fetch errors and falls back instead of throwing', async () => {
    const session = { fetch: jest.fn().mockRejectedValue(new Error('network down')) };
    const dispatcher = new ZoneEventDispatcher('http://api.local', session);

    const event = { type: 'usage_event' };
    await expect(dispatcher.dispatch(event)).resolves.toBe(false);
    expect(dispatcher.drainFallback()).toEqual([event]);
  });

  test('drainFallback empties the fallback queue', async () => {
    const session = fakeSession({ ok: false, status: 500 });
    const dispatcher = new ZoneEventDispatcher('http://api.local', session);

    await dispatcher.dispatch({ type: 'a' });
    dispatcher.drainFallback();

    expect(dispatcher.drainFallback()).toEqual([]);
  });

  test('is subclassable with no private fields blocking it', async () => {
    class FakeDispatcher extends ZoneEventDispatcher {
      async dispatch(event) {
        this.lastEvent = event;
        return true;
      }
    }
    const fake = new FakeDispatcher('http://api.local');
    await fake.dispatch({ type: 'occupancy_event' });

    expect(fake.lastEvent).toEqual({ type: 'occupancy_event' });
  });
});
