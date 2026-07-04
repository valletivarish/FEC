// Thin fetch wrapper — keeps the dashboard components ignorant of HTTP/error details.
export class OfficeIqApiClient {
  constructor(apiBaseUrl) {
    this.apiBaseUrl = apiBaseUrl;
  }

  async getZoneStatus(zoneId) {
    return this._get(`/zones/${zoneId}/status`);
  }

  async getZoneHistory(zoneId) {
    return this._get(`/zones/${zoneId}/history`);
  }

  async _get(path) {
    const response = await fetch(`${this.apiBaseUrl}${path}`);
    if (!response.ok) {
      throw new Error(`OfficeIQ API request failed: ${response.status} ${path}`);
    }
    return response.json();
  }
}
