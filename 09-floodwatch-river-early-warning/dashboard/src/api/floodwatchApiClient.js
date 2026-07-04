// Thin fetch wrapper over the reach status endpoint; base URL is configurable so the same
// code path works against the local emulator and real AWS without edits.
export class FloodwatchApiClient {
  constructor(apiBaseUrl) {
    this.apiBaseUrl = apiBaseUrl.replace(/\/$/, "");
  }

  async getReachStatus(reachId) {
    const response = await fetch(`${this.apiBaseUrl}/reaches/${reachId}/status`);
    if (!response.ok) {
      throw new Error(`Reach status request failed for ${reachId}: ${response.status}`);
    }
    return response.json();
  }

  async getAllReachStatuses(reachIds) {
    const results = await Promise.allSettled(reachIds.map((id) => this.getReachStatus(id)));
    return results.map((result, index) => ({
      reachId: reachIds[index],
      ok: result.status === "fulfilled",
      data: result.status === "fulfilled" ? result.value : null,
    }));
  }
}
