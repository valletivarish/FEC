import { HubApiClient } from './api/hubApiClient.js';
import { BayRosterTable } from './components/bayRosterTable.js';
import { TransformerStatusLine } from './components/transformerStatusLine.js';
import { DerStatusLine } from './components/derStatusLine.js';
import { CurtailmentLogTable } from './components/curtailmentLogTable.js';
import { HubKpiRow } from './components/hubKpiRow.js';

// swap only this to point at a real deployed API Gateway stage; no code path changes
const API_BASE_URL = window.GRIDPULSE_API_BASE_URL || 'http://localhost:3000';
const POLL_INTERVAL_MS = 5000;
const HUB_ID = window.GRIDPULSE_HUB_ID || 'hub-01';

export class SwitchboardApp {
  constructor({ apiClient, hubId, root = document } = {}) {
    this.apiClient = apiClient;
    this.hubId = hubId;
    this.root = root;

    this.hubStatusEl = root.getElementById('hub-status-line');
    this.kpiRow = new HubKpiRow(root.getElementById('hub-kpi-row'));
    this.bayRoster = new BayRosterTable(root.getElementById('bay-roster'));
    this.transformerStatus = new TransformerStatusLine(root.getElementById('transformer-status'));
    this.derStatus = new DerStatusLine(root.getElementById('der-status'));
    this.curtailmentLog = new CurtailmentLogTable(root.getElementById('curtailment-log'));
  }

  async refresh() {
    try {
      const [summary, bays] = await Promise.all([
        this.apiClient.getHubSummary(this.hubId),
        this.apiClient.getHubBays(this.hubId),
      ]);
      const bayList = this.#applyBays(bays);
      this.#applySummary(summary, bayList);
    } catch (err) {
      console.error('Switchboard refresh failed:', err);
      this.#renderHubStatus({ rung: undefined, rungLabel: 'offline' });
      this.#renderNoLiveData();
    }
  }

  #applySummary(summary = {}, bays = []) {
    const transformer = summary.transformer || {};
    const curtailment = summary.curtailment || {};

    const feeder = summary.feeder || {};
    this.transformerStatus.update({
      windingTemp: transformer.windingTemp,
      loadAmps: transformer.loadAmps,
      rung: curtailment.rung,
      rungLabel: curtailment.rungLabel,
      feederVoltage: feeder.voltage,
      feederFrequency: feeder.frequency,
      feederStatus: feeder.status,
    });

    const der = summary.der || {};
    this.derStatus.update({
      solarKw: der.solarKw,
      batterySoc: der.batterySoc,
      tariffPrice: der.tariffPrice,
      mode: der.mode,
    });

    this.#renderHubStatus(curtailment);

    const events = summary.curtailmentEvents || (curtailment.rungLabel ? [curtailment] : []);
    this.curtailmentLog.update(events);

    // KPIs are aggregated from the same fetched payload the panels render - never fabricated
    this.kpiRow.update({ bays, transformer, curtailmentEvents: events });
  }

  #renderHubStatus({ rung, rungLabel }) {
    this.hubStatusEl.innerHTML = `
      <h1 class="page-title">Hub Switchboard</h1>
      <div class="status-plaque" data-testid="hub-status-line-inner">
        <span class="status-plaque-value fw-semibold">${this.hubId}</span>
        <span class="badge rounded-pill ${hubBadgeClass(rung, rungLabel)}" data-testid="hub-rung-label">${rungLabel ?? 'normal'}</span>
      </div>
    `;
  }

  #renderNoLiveData() {
    this.bayRoster.update([]);
    this.transformerStatus.update({});
    this.derStatus.update({});
    this.curtailmentLog.update([]);
    this.kpiRow.update({ bays: [], transformer: {}, curtailmentEvents: [] });
    this.hubStatusEl.insertAdjacentHTML(
      'beforeend',
      '<span class="status-plaque-pill" data-testid="no-live-data">No live data — start the local stack</span>',
    );
  }

  #applyBays(bays) {
    const list = Array.isArray(bays) ? bays : bays?.bays || [];
    this.bayRoster.update(list);
    return list;
  }

  start() {
    this.refresh();
    this.timer = setInterval(() => this.refresh(), POLL_INTERVAL_MS);
  }

  stop() {
    clearInterval(this.timer);
  }
}

function hubBadgeClass(rung, rungLabel) {
  if (rungLabel === 'offline') return 'text-bg-secondary';
  if (rung === 2 || rung === 3) return 'text-bg-danger';
  if (rung === 1) return 'text-bg-warning';
  return 'text-bg-success';
}

function bootstrap() {
  const apiClient = new HubApiClient(API_BASE_URL);
  const app = new SwitchboardApp({ apiClient, hubId: HUB_ID });
  app.start();
  window.__switchboardApp = app;
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', bootstrap);
} else {
  bootstrap();
}
