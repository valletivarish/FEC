'use strict';

// Concrete (not abstract) so tests can instantiate directly or subclass to stub dispatch().
class ZoneEventDispatcher {
  constructor(apiBaseUrl, session) {
    this.apiBaseUrl = apiBaseUrl;
    this.session = session || { fetch: (...args) => fetch(...args) };
    this._fallback = [];
  }

  async dispatch(event) {
    try {
      const response = await this.session.fetch(`${this.apiBaseUrl}/events`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(event),
      });
      if (response && response.ok) {
        return true;
      }
      this._fallback.push(event);
      return false;
    } catch {
      // network/parse failures degrade to the fallback queue instead of crashing the caller
      this._fallback.push(event);
      return false;
    }
  }

  drainFallback() {
    const drained = this._fallback;
    this._fallback = [];
    return drained;
  }
}

module.exports = { ZoneEventDispatcher };
