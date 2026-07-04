// Thin fetch wrapper — keeps the API base URL configurable without touching call sites.
export class GreenGridApiClient {
  constructor(apiBaseUrl) {
    this.apiBaseUrl = apiBaseUrl;
  }

  async getStationEvents(stationId) {
    const response = await fetch(`${this.apiBaseUrl}/stations/${stationId}/events`);
    if (!response.ok) {
      throw new Error(`GreenGrid API returned ${response.status} for station ${stationId}`);
    }
    return response.json();
  }
}
