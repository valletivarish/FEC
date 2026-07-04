// KPI summary strip - every value is aggregated from the live hub payload, never fabricated
export class HubKpiRow {
  constructor(container) {
    this.container = container;
    this.container.innerHTML = `
      <div class="kpi-row" aria-label="Hub summary">
        <div class="kpi-card">
          <span class="kpi-icon kpi-icon-amber"><i class="bi bi-ev-station"></i></span>
          <div>
            <div class="kpi-value" data-kpi="bays">0</div>
            <div class="kpi-label">Charger Bays</div>
          </div>
        </div>
        <div class="kpi-card">
          <span class="kpi-icon kpi-icon-green"><i class="bi bi-lightning-charge"></i></span>
          <div>
            <div class="kpi-value" data-kpi="active-sessions">0</div>
            <div class="kpi-label">Active Sessions</div>
          </div>
        </div>
        <div class="kpi-card">
          <span class="kpi-icon kpi-icon-red"><i class="bi bi-exclamation-triangle"></i></span>
          <div>
            <div class="kpi-value" data-kpi="faults">0</div>
            <div class="kpi-label">Bay Faults</div>
          </div>
        </div>
        <div class="kpi-card">
          <span class="kpi-icon kpi-icon-slate"><i class="bi bi-thermometer-half"></i></span>
          <div>
            <div class="kpi-value" data-kpi="transformer-load">—</div>
            <div class="kpi-label">Transformer Load (A)</div>
          </div>
        </div>
        <div class="kpi-card">
          <span class="kpi-icon kpi-icon-blue"><i class="bi bi-clock-history"></i></span>
          <div>
            <div class="kpi-value" data-kpi="curtailment-events">0</div>
            <div class="kpi-label">Curtailment Events</div>
          </div>
        </div>
      </div>
    `;
  }

  update({ bays = [], transformer = {}, curtailmentEvents = [] } = {}) {
    const bayList = Array.isArray(bays) ? bays : [];
    const activeSessions = bayList.filter((bay) => bay.connectorState === 'charging').length;
    const faults = bayList.filter((bay) => bay.connectorState === 'fault').length;
    const load = transformer.loadAmps;

    this.#set('bays', String(bayList.length));
    this.#set('active-sessions', String(activeSessions));
    this.#set('faults', String(faults));
    this.#set('transformer-load', typeof load === 'number' && Number.isFinite(load) ? load.toFixed(0) : '—');
    this.#set('curtailment-events', String(Array.isArray(curtailmentEvents) ? curtailmentEvents.length : 0));
  }

  #set(key, value) {
    const el = this.container.querySelector(`[data-kpi="${key}"]`);
    if (el) el.textContent = value;
  }
}
