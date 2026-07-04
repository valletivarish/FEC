// Thin fetch wrapper around the QueryApiHandler's GET /pumps/{pumpId}/insights route.
export class FlowforgeApiClient {
  constructor(apiBaseUrl) {
    this.apiBaseUrl = apiBaseUrl;
  }

  // Returns the parsed insight array for one pump, or throws on network/HTTP failure.
  async fetchPumpInsights(pumpId) {
    const response = await fetch(`${this.apiBaseUrl}/pumps/${pumpId}/insights`);
    if (!response.ok) {
      throw new Error(`FlowForge API returned ${response.status} for pump ${pumpId}`);
    }
    // QueryApiHandler wraps the array as { pumpId, insights } - unwrap it here.
    const payload = await response.json();
    return payload.insights || [];
  }

  // Fan out across the fixed 3-pump farm; a single pump failing must not blank the whole dashboard.
  async fetchAllInsights(pumpIds) {
    const results = await Promise.allSettled(
      pumpIds.map((pumpId) => this.fetchPumpInsights(pumpId))
    );
    return results.flatMap((result) => (result.status === 'fulfilled' ? result.value : []));
  }
}
