import { GreenhouseGuardApiClient } from './api/greenhouseGuardApiClient.js';
import { renderKpiRow } from './components/kpiRow.js';
import { renderBenchOverviewPanel } from './components/benchOverviewPanel.js';
import { renderFertigationTable } from './components/fertigationTable.js';
import { renderFaultsLogTable } from './components/faultsLogTable.js';

const ZONE_IDS = ['zone-a', 'zone-b', 'zone-c'];
const API_BASE_URL = window.GREENHOUSEGUARD_API_BASE_URL || 'http://localhost:3000';

// vent-position-actual only ever appears on enclosure_fault_event rows in the faults table;
// VPD comes straight off the command ledger's own setpoint_command payload.
function deriveVentActual(faults) {
  const latestFault = faults
    .filter((f) => f.type === 'enclosure_fault_event')
    .sort((a, b) => (a.timestamp < b.timestamp ? 1 : -1))[0];
  return latestFault ? latestFault.ventPositionActual : null;
}

function deriveFertigationRows(zoneId, faults) {
  const fertigationEvents = faults.filter((f) => f.type === 'fertigation_event');
  const latestByMetric = new Map();
  fertigationEvents
    .sort((a, b) => (a.timestamp < b.timestamp ? -1 : 1))
    .forEach((event) => {
      latestByMetric.set(event.metric, event);
    });
  return [...latestByMetric.values()].map((event) => ({ zoneId, ...event }));
}

function faultsForLog(zoneId, faults) {
  return faults
    .filter((f) => f.type !== 'fertigation_event')
    .map((f) => ({ zoneId, ...f }));
}

// sidebar zone chips mirror the faults log's own definition of "active" (unacknowledged,
// non-fertigation) so the strip never invents a status the Faults panel doesn't already show
function updateZoneStrip(zoneStatuses) {
  const strip = document.getElementById('sidebar-zone-strip');
  if (!strip) return;

  zoneStatuses.forEach((status) => {
    const chip = strip.querySelector(`[data-zone-chip="${status.zoneId}"] .sidebar-zone-dot`);
    if (!chip) return;
    const hasActiveFault = faultsForLog(status.zoneId, status.faults).some((f) => !f.acknowledged);
    chip.classList.remove('gg-zone-fault', 'gg-zone-nominal');
    chip.classList.add(hasActiveFault ? 'gg-zone-fault' : 'gg-zone-nominal');
    chip.title = `${status.zoneId}: ${hasActiveFault ? 'fault' : 'nominal'}`;
  });
}

// header meta shows the worst-case (highest) live VPD across zones — the single figure
// an operator glancing at the header needs, same source as each bench card's own reading
function updateHeaderVpd(zoneStatuses) {
  const vpdEl = document.getElementById('header-vpd');
  if (!vpdEl) return;

  const vpdReadings = zoneStatuses
    .map((status) => (status.latestCommand ? status.latestCommand.vpdKpa : null))
    .filter((vpd) => vpd != null);

  vpdEl.textContent = vpdReadings.length ? `Peak VPD ${Math.max(...vpdReadings).toFixed(2)} kPa` : 'Peak VPD –';
}

async function loadDashboard() {
  const apiClient = new GreenhouseGuardApiClient(API_BASE_URL);
  const kpiContainer = document.getElementById('kpi-row');
  const benchContainer = document.getElementById('bench-overview-panel');
  const fertigationContainer = document.getElementById('fertigation-table-container');
  const faultsContainer = document.getElementById('faults-log-container');

  let zoneStatuses;
  try {
    const results = await Promise.all(ZONE_IDS.map((zoneId) => apiClient.getZoneStatus(zoneId)));
    zoneStatuses = results;
  } catch {
    renderKpiRow(kpiContainer, []);
    renderBenchOverviewPanel(benchContainer, []);
    renderFertigationTable(fertigationContainer, []);
    renderFaultsLogTable(faultsContainer, [], apiClient);
    return;
  }

  renderKpiRow(kpiContainer, zoneStatuses);
  updateHeaderVpd(zoneStatuses);
  updateZoneStrip(zoneStatuses);

  const benchViewModels = zoneStatuses.map((status) => ({
    zoneId: status.zoneId,
    latestCommand: status.latestCommand,
    ventActual: deriveVentActual(status.faults),
    vpdKpa: status.latestCommand ? status.latestCommand.vpdKpa : null,
    faults: status.faults
  }));

  const allFertigationRows = zoneStatuses.flatMap((status) =>
    deriveFertigationRows(status.zoneId, status.faults)
  );

  const allLogEntries = zoneStatuses.flatMap((status) => faultsForLog(status.zoneId, status.faults));

  renderBenchOverviewPanel(benchContainer, benchViewModels);
  renderFertigationTable(fertigationContainer, allFertigationRows);
  renderFaultsLogTable(faultsContainer, allLogEntries, apiClient);
}

loadDashboard();
