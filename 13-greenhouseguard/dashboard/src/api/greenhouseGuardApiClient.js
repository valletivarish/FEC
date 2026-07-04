// Fetch wrapper for the GreenhouseGuard zone-status and fault-acknowledge endpoints.
export class GreenhouseGuardApiClient {
  constructor(apiBaseUrl, fetchImpl = fetch.bind(globalThis)) {
    this.apiBaseUrl = apiBaseUrl;
    this.fetchImpl = fetchImpl;
  }

  async getZoneStatus(zoneId) {
    const response = await this.fetchImpl(`${this.apiBaseUrl}/zones/${zoneId}/status`);
    if (!response.ok) {
      throw new Error(`getZoneStatus failed for ${zoneId}: ${response.status}`);
    }
    return response.json();
  }

  async acknowledgeFault(zoneId, eventTypeTimestamp) {
    const response = await this.fetchImpl(`${this.apiBaseUrl}/zones/${zoneId}/faults/acknowledge`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ eventTypeTimestamp })
    });
    if (!response.ok) {
      throw new Error(`acknowledgeFault failed for ${zoneId}: ${response.status}`);
    }
    return response.json();
  }
}
