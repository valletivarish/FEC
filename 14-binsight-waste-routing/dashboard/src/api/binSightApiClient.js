// fetch must be bound to globalThis — an unbound bare reference throws "Illegal invocation"
// once Playwright's page.route intercepts it, silently swallowed by any surrounding try/catch.
export class BinSightApiClient {
  constructor(apiBaseUrl, fetchImpl = fetch.bind(globalThis)) {
    this.apiBaseUrl = apiBaseUrl;
    this.fetchImpl = fetchImpl;
  }

  async getDepotStatus() {
    const response = await this.fetchImpl(`${this.apiBaseUrl}/depot/status`);
    if (!response.ok) {
      throw new Error(`depot/status request failed with status ${response.status}`);
    }
    return response.json();
  }
}
