import { PondApiClient } from './api/pondApiClient.js';
import { renderPondAccordion } from './components/pondAccordion.js';
import { renderAlertLedgerTable } from './components/alertLedgerTable.js';
import { renderKpiRow, updateKpiRow } from './components/kpiSummary.js';

// No build step, so the API base is a runtime global rather than an env var.
const API_BASE_URL = window.AQUASENTINEL_API_BASE_URL || 'http://localhost:4566/restapis/local/prod/_user_request_';
// Local-only floci workaround (see pondApiClient.js); false by default, including on real AWS.
const USE_LOCAL_FALLBACK = window.AQUASENTINEL_USE_LOCAL_FALLBACK === true;
const POLL_INTERVAL_MS = 10000;

const client = new PondApiClient(API_BASE_URL, USE_LOCAL_FALLBACK);

function pondToxicity(pondId, alerts, entry) {
  const toxicityAlerts = alerts.filter((a) => a.type === 'toxicity' && a.pond_id === pondId);
  if (toxicityAlerts.length > 0) {
    return toxicityAlerts.sort((a, b) => (a.timestamp < b.timestamp ? 1 : -1))[0];
  }
  // fall back to the pond's own status payload, which merges in urgent toxicity from the alerts table too
  if (!entry.ok || !entry.data || !Array.isArray(entry.data.latest_readings)) return null;
  const item = entry.data.latest_readings.find((r) => r.type === 'toxicity');
  if (!item) return null;
  return { pond_id: pondId, ...item.payload };
}

async function refresh() {
  const accordionEl = document.getElementById('pond-accordion');
  const ledgerBody = document.getElementById('alert-ledger-body');
  const connectionBanner = document.getElementById('connection-banner');
  const kpiEl = document.getElementById('kpi-row');

  try {
    const [pondEntries, alerts] = await Promise.all([client.getAllStatuses(), client.getAllAlerts()]);

    const anyLive = pondEntries.some((e) => e.ok);
    connectionBanner.classList.toggle('d-none', anyLive);

    // life_support/ops_feed_correlation are read by pondAccordion straight from entry.data.latest_readings
    // (the /status response) -- the dispatcher never routes those types to /alerts, only urgent toxicity.
    const pondBundles = pondEntries.map((entry) => ({
      pondId: entry.pondId,
      ok: entry.ok,
      data: entry.data,
      toxicityEvent: pondToxicity(entry.pondId, alerts, entry),
    }));

    renderPondAccordion(accordionEl, pondBundles);
    renderAlertLedgerTable(ledgerBody, alerts);
    updateKpiRow(kpiEl, pondBundles, alerts);
  } catch (err) {
    connectionBanner.classList.remove('d-none');
    renderPondAccordion(accordionEl, []);
    renderAlertLedgerTable(ledgerBody, []);
    updateKpiRow(kpiEl, [], []);
  }
}

renderKpiRow(document.getElementById('kpi-row'));
refresh();
setInterval(refresh, POLL_INTERVAL_MS);
