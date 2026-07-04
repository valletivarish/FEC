// bind fetch to globalThis — a bare `fetch` reference throws "Illegal invocation"
// once Playwright's page.route (or any monkey-patch) intercepts it.
export class HarborPulseApiClient {
  constructor(apiBaseUrl, fetchImpl = fetch.bind(globalThis)) {
    this.apiBaseUrl = apiBaseUrl;
    this.fetchImpl = fetchImpl;
  }

  async getFleetSummary() {
    const response = await this.fetchImpl(`${this.apiBaseUrl}/fleet/summary`);
    if (!response.ok) {
      throw new Error(`fleet summary request failed: ${response.status}`);
    }
    return response.json();
  }

  async getVesselTelemetry(vesselId) {
    const response = await this.fetchImpl(`${this.apiBaseUrl}/vessels/${vesselId}/telemetry`);
    if (!response.ok) {
      throw new Error(`vessel telemetry request failed: ${response.status}`);
    }
    return response.json();
  }
}
