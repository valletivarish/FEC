// thin fetch wrapper so components never know the API base URL or HTTP details
export class HubApiClient {
  constructor(baseUrl) {
    this.baseUrl = baseUrl.replace(/\/$/, '');
  }

  async getHubSummary(hubId) {
    return this.#getJson(`/hubs/${encodeURIComponent(hubId)}/summary`);
  }

  async getHubBays(hubId) {
    return this.#getJson(`/hubs/${encodeURIComponent(hubId)}/bays`);
  }

  async #getJson(path) {
    const response = await fetch(`${this.baseUrl}${path}`);
    if (!response.ok) {
      throw new Error(`GridPulse API request failed: ${response.status} ${path}`);
    }
    return response.json();
  }
}
