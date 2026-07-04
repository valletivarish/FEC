'use strict';

const RETRY_DELAYS_MS = [200, 400, 800];
const FALLBACK_CAPACITY = 200;
const REPLAY_INTERVAL_MS = 30000;

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// Posts one fog event, retrying with backoff before giving up to the caller.
async function postEvent(apiBaseUrl, fogEvent) {
  const url = `${apiBaseUrl}/v1/fog-events`;
  let lastErr;
  for (let attempt = 0; attempt <= RETRY_DELAYS_MS.length; attempt += 1) {
    try {
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(fogEvent)
      });
      if (!res.ok) {
        throw new Error(`fog-events POST failed with status ${res.status}`);
      }
      return;
    } catch (err) {
      lastErr = err;
      if (attempt < RETRY_DELAYS_MS.length) {
        await sleep(RETRY_DELAYS_MS[attempt]);
      }
    }
  }
  throw lastErr;
}

// Fog nodes run unattended, so failed dispatches must queue locally rather than crash the process.
class FogDispatcher {
  constructor(apiBaseUrl, options = {}) {
    this.apiBaseUrl = apiBaseUrl;
    this.fallbackQueue = [];
    // Optional hook so the node's real NodeMetrics counter increments only on an actual dispatch attempt.
    this.onDispatched = options.onDispatched || (() => {});
    this.replayTimer = setInterval(() => {
      this.drainFallback().catch(() => {});
    }, REPLAY_INTERVAL_MS);
    if (typeof this.replayTimer.unref === 'function') {
      this.replayTimer.unref();
    }
  }

  async dispatch(fogEvent) {
    try {
      await postEvent(this.apiBaseUrl, fogEvent);
      this.onDispatched(fogEvent);
    } catch {
      this._pushFallback(fogEvent);
    }
  }

  // Bounded so a prolonged backend outage cannot grow memory without limit.
  _pushFallback(fogEvent) {
    if (this.fallbackQueue.length >= FALLBACK_CAPACITY) {
      this.fallbackQueue.shift();
    }
    this.fallbackQueue.push(fogEvent);
  }

  // Replays queued events oldest-first; anything that still fails is re-queued.
  async drainFallback() {
    const pending = this.fallbackQueue;
    this.fallbackQueue = [];
    for (const fogEvent of pending) {
      try {
        await postEvent(this.apiBaseUrl, fogEvent);
      } catch {
        this._pushFallback(fogEvent);
      }
    }
  }

  stop() {
    clearInterval(this.replayTimer);
  }
}

module.exports = { FogDispatcher };
