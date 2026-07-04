// Thin fetch wrapper around the pond_query Lambda's two GET routes.
// Kept dependency-free so the dashboard has zero build step.

const PONDS = ['pond-01', 'pond-02', 'pond-03', 'pond-04'];

export class PondApiClient {
  // useLocalFallback is an additive local-testing switch (off in real deployments): floci's API
  // Gateway v2 router can't build a valid regex for the {pond_id} path parameter (Java rejects the
  // underscore in the named capturing group it generates), so /ponds/{id}/status and
  // /ponds/{id}/alerts always 500 there. A Lambda Function URL invokes the same Lambda with no
  // path-template regex involved -- but floci also never emits CORS headers on Function URL
  // responses, so a direct cross-origin fetch to it is blocked by the browser regardless. The
  // fallback instead re-requests the same path from this dashboard's own origin, which `npm run
  // serve:floci-fallback` proxies to the Function URL server-side (see package.json), so the
  // browser only ever sees a same-origin response. Real AWS never sets this, so it never engages.
  constructor(apiBaseUrl, useLocalFallback = false) {
    this.apiBaseUrl = apiBaseUrl.replace(/\/$/, '');
    this.useLocalFallback = useLocalFallback;
  }

  async _getWithFallback(pathSuffix, errorLabel, pondId) {
    try {
      const res = await fetch(`${this.apiBaseUrl}${pathSuffix}`);
      if (!res.ok) throw new Error(`${errorLabel} ${res.status} for ${pondId}`);
      return await res.json();
    } catch (err) {
      if (!this.useLocalFallback) throw err;
      const res = await fetch(pathSuffix);
      if (!res.ok) throw new Error(`${errorLabel} fallback ${res.status} for ${pondId}`);
      return res.json();
    }
  }

  async getStatus(pondId) {
    return this._getWithFallback(`/ponds/${pondId}/status`, 'status', pondId);
  }

  async getAlerts(pondId) {
    return this._getWithFallback(`/ponds/${pondId}/alerts`, 'alerts', pondId);
  }

  // Fans out across every known pond; a single pond failing must not blank the rest.
  async getAllStatuses() {
    const results = await Promise.allSettled(PONDS.map((id) => this.getStatus(id)));
    return results.map((r, i) => ({
      pondId: PONDS[i],
      ok: r.status === 'fulfilled',
      data: r.status === 'fulfilled' ? r.value : null,
    }));
  }

  async getAllAlerts() {
    const results = await Promise.allSettled(PONDS.map((id) => this.getAlerts(id)));
    return results.flatMap((r, i) => {
      if (r.status !== 'fulfilled') return [];
      const body = r.value;
      const alerts = Array.isArray(body.alerts) ? body.alerts : [];
      return alerts.map((a) => ({ ...a, pond_id: a.pond_id || PONDS[i] }));
    });
  }
}

export { PONDS };
