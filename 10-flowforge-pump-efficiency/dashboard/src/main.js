import { FlowforgeApiClient } from './api/flowforgeApiClient.js';
import { renderPumpHealthTable } from './components/pumpHealthTable.js';
import { renderHydraulicEfficiencyTable } from './components/hydraulicEfficiencyTable.js';
import { renderSealIntegrityTable } from './components/sealIntegrityTable.js';
import { renderInsightLogTable } from './components/insightLogTable.js';
import { renderFarmSummary, updateFarmSummary } from './components/farmSummary.js';

const PUMP_IDS = ['pump-01', 'pump-02', 'pump-03'];
const REFRESH_INTERVAL_MS = 10000;

// Query-string override lets a tester/marker point the dashboard at a different backend
// without editing source; defaults to the local API Gateway emulator route.
function resolveApiBaseUrl() {
  const params = new URLSearchParams(window.location.search);
  return params.get('apiBaseUrl') || window.FLOWFORGE_API_BASE_URL || 'http://localhost:4566/restapis/flowforge/local/_user_request_';
}

function renderEmptyState(message) {
  const el = document.getElementById('empty-state');
  el.textContent = message;
  el.classList.remove('d-none');
  setLiveStatus(false);
}

function hideEmptyState() {
  document.getElementById('empty-state').classList.add('d-none');
  setLiveStatus(true);
}

// The header's "Live" indicator and the acquisition bar's signal state both reflect
// real connection status, not a static label - offline whenever the last fetch failed
// or returned no data, matching the same condition that shows the empty-state banner.
function setLiveStatus(isLive) {
  const dot = document.querySelector('.ff-live-dot');
  const label = document.getElementById('live-status-label');
  const acqBar = document.getElementById('acq-bar');
  const signalState = document.getElementById('acq-signal-state');
  if (dot) dot.classList.toggle('ff-live-dot-offline', !isLive);
  if (label) label.textContent = isLive ? 'Live' : 'Offline';
  if (acqBar) acqBar.classList.toggle('ff-acq-degraded', !isLive);
  if (signalState) signalState.textContent = isLive ? 'NOMINAL' : 'NO SIGNAL';
}

function renderAll(events) {
  document.getElementById('pump-health-container').innerHTML = renderPumpHealthTable(PUMP_IDS, events);
  document.getElementById('hydraulic-efficiency-container').innerHTML = renderHydraulicEfficiencyTable(PUMP_IDS, events);
  document.getElementById('seal-integrity-container').innerHTML = renderSealIntegrityTable(PUMP_IDS, events);
  document.getElementById('insight-log-container').innerHTML = renderInsightLogTable(events);
  updateFarmSummary(document.getElementById('kpi-row'), PUMP_IDS, events);
}

export async function loadDashboard(apiClient = new FlowforgeApiClient(resolveApiBaseUrl())) {
  try {
    const events = await apiClient.fetchAllInsights(PUMP_IDS);
    if (events.length === 0) {
      renderEmptyState('No live data — start the local stack to see readings');
    } else {
      hideEmptyState();
      // Acquisition bar reflects real dispatch activity, not just page-load time.
      if (typeof window !== 'undefined' && typeof window.__flowforgeMarkDownlink === 'function') {
        window.__flowforgeMarkDownlink();
      }
    }
    renderAll(events);
  } catch (error) {
    renderEmptyState('No live data — start the local stack to see readings');
    renderAll([]);
  }
}

// Sidebar items scroll to their section and mark themselves active - the four sections
// stay on one page (one fetch cycle feeds them all), matching the single-query data flow.
function wireNav() {
  const links = document.querySelectorAll('.sidebar-link');
  links.forEach((button) => {
    button.addEventListener('click', () => {
      links.forEach((b) => b.classList.toggle('sidebar-link-active', b === button));
      const target = document.getElementById(button.dataset.target);
      if (target) target.scrollIntoView({ behavior: 'smooth', block: 'start' });
    });
  });
}

function init() {
  renderFarmSummary(document.getElementById('kpi-row'), PUMP_IDS);
  wireNav();
  loadDashboard();
  setInterval(() => loadDashboard(), REFRESH_INTERVAL_MS);
}

if (typeof window !== 'undefined' && !window.__FLOWFORGE_SKIP_AUTOINIT__) {
  document.addEventListener('DOMContentLoaded', init);
}
