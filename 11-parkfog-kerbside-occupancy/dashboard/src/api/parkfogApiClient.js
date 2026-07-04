// Thin fetch wrapper — kept separate from render logic so tests can mock at the network layer.
export class ParkfogApiClient {
  // Bind to globalThis: an unbound `fetch` reference throws "Illegal invocation" when called as this.fetchImpl(...).
  constructor(apiBaseUrl, fetchImpl = fetch.bind(globalThis)) {
    this.apiBaseUrl = apiBaseUrl;
    this.fetchImpl = fetchImpl;
  }

  async getZoneStatus(zoneId) {
    const response = await this.fetchImpl(`${this.apiBaseUrl}/zones/${zoneId}/status`);
    if (!response.ok) {
      throw new Error(`ParkFog API responded with status ${response.status}`);
    }
    return response.json();
  }
}
