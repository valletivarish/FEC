// Thin fetch wrapper so components never touch fetch/URLs directly.
export class CareWatchApiClient {
  // fetch.bind(globalThis) avoids "Illegal invocation" when fetch is monkey-patched (e.g. Playwright page.route).
  constructor(apiBaseUrl, fetchImpl = fetch.bind(globalThis)) {
    this.apiBaseUrl = apiBaseUrl;
    this.fetchImpl = fetchImpl;
  }

  async getResidents() {
    const response = await this.fetchImpl(`${this.apiBaseUrl}/residents`);
    if (!response.ok) {
      throw new Error(`getResidents failed: ${response.status}`);
    }
    return response.json();
  }

  async getResidentHistory(residentId) {
    const response = await this.fetchImpl(`${this.apiBaseUrl}/residents/${residentId}/history`);
    if (!response.ok) {
      throw new Error(`getResidentHistory failed: ${response.status}`);
    }
    return response.json();
  }

  async acknowledgeResident(residentId) {
    const response = await this.fetchImpl(`${this.apiBaseUrl}/residents/${residentId}/acknowledge`, {
      method: 'POST',
    });
    if (!response.ok) {
      throw new Error(`acknowledgeResident failed: ${response.status}`);
    }
    return response.json();
  }
}
