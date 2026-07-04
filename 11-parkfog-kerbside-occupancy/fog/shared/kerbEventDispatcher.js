class KerbEventDispatcher {
  constructor(apiBaseUrl, session) {
    this.apiBaseUrl = apiBaseUrl;
    this.session = session || { fetch };
    this.fallback = [];
  }

  async dispatch(event) {
    try {
      const res = await this.session.fetch(`${this.apiBaseUrl}/events`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(event),
      });
      if (res && res.ok) {
        return true;
      }
      this.fallback.push(event);
      return false;
    } catch {
      this.fallback.push(event);
      return false;
    }
  }

  drainFallback() {
    const drained = this.fallback;
    this.fallback = [];
    return drained;
  }
}

module.exports = { KerbEventDispatcher };
