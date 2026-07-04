class GreenhouseEventDispatcher {
  constructor(apiBaseUrl, session) {
    this.apiBaseUrl = apiBaseUrl;
    this.session = session || { fetch: (...args) => fetch(...args) };
    this.fallback = [];
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

module.exports = { GreenhouseEventDispatcher };
