import { ParkfogApiClient } from './api/parkfogApiClient.js';
import { renderBayStatusTable } from './components/bayStatusTable.js';
import { renderOverstayPressureTable } from './components/overstayPressureTable.js';
import { renderKerbConditionsTable } from './components/kerbConditionsTable.js';
import { renderEventLogTable } from './components/eventLogTable.js';
import { renderDebounceTraceLog } from './components/debounceTraceLog.js';
import { renderKpiRow, updateKpiRow } from './components/kpiSummary.js';

const ZONE_ID = 'zone-01';
const API_BASE_URL = window.PARKFOG_API_BASE_URL || 'http://localhost:3000';
const POLL_INTERVAL_MS = 5000;

function splitEventsByType(events) {
  const bayEvents = events.filter((e) => e.type === 'bay_state_event');
  const overstayPressureEvents = events.filter(
    (e) => e.type === 'overstay_event' || e.type === 'zone_pressure_event'
  );
  const kerbConditionEvents = events.filter(
    (e) => e.type === 'flood_risk_event' || e.type === 'ev_fault_event'
  );
  return { bayEvents, overstayPressureEvents, kerbConditionEvents };
}

function renderAll(events) {
  const { bayEvents, overstayPressureEvents, kerbConditionEvents } = splitEventsByType(events);

  renderBayStatusTable(document.getElementById('bay-status-body'), bayEvents);
  renderOverstayPressureTable(document.getElementById('overstay-pressure-body'), overstayPressureEvents);
  renderKerbConditionsTable(document.getElementById('kerb-conditions-body'), kerbConditionEvents);
  renderEventLogTable(document.getElementById('event-log-body'), events);
  renderDebounceTraceLog(document.getElementById('debounce-trace-log'), events);
  updateKpiRow(document.getElementById('kpi-row'), events);
}

function showEmptyState(message) {
  const alertEl = document.getElementById('empty-state');
  alertEl.textContent = message;
  alertEl.classList.remove('d-none');
}

function hideEmptyState() {
  document.getElementById('empty-state').classList.add('d-none');
}

async function refresh(client) {
  try {
    const status = await client.getZoneStatus(ZONE_ID);
    const events = status.events || [];
    if (events.length === 0) {
      showEmptyState('No live data — start the local stack to see readings');
    } else {
      hideEmptyState();
    }
    renderAll(events);
  } catch {
    showEmptyState('No live data — start the local stack to see readings');
    renderAll([]);
  }
}

function init() {
  document.getElementById('zone-label').textContent = ZONE_ID;
  document.getElementById('zone-crumb').textContent = ZONE_ID;
  renderKpiRow(document.getElementById('kpi-row'));
  const client = new ParkfogApiClient(API_BASE_URL);
  refresh(client);
  setInterval(() => refresh(client), POLL_INTERVAL_MS);
}

init();
