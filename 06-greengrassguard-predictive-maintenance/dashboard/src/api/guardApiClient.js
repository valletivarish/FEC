const DEFAULT_API_BASE_URL = 'http://localhost:3000';

// small wrapper so components never touch fetch/response-shape details directly
export class GuardApiClient {
  constructor(apiBaseUrl = DEFAULT_API_BASE_URL) {
    this.apiBaseUrl = apiBaseUrl;
  }

  async getDiagnoses(assetId) {
    const res = await fetch(`${this.apiBaseUrl}/assets/${assetId}/diagnoses`);
    if (!res.ok) {
      throw new Error(`guard api error: ${res.status}`);
    }
    return res.json();
  }
}
