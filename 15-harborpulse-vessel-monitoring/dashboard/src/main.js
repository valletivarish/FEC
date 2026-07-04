import { HarborPulseApiClient } from './api/harborPulseApiClient.js';
import { drawRangeRings, drawFleetRadar, renderFleetRadarLegend } from './components/fleetRadarCanvas.js';
import { renderEngineHealthTable } from './components/engineHealthTable.js';
import { renderSeaStateTable } from './components/seaStateTable.js';
import { renderSafetyAlarmsTable } from './components/safetyAlarmsTable.js';
import { renderKpiRow, updateKpiRow } from './components/fleetKpiRow.js';

const API_BASE_URL = window.HARBORPULSE_API_BASE_URL || 'http://localhost:3000';

// three fog nodes defined by the architecture: EngineFog, SeaStateFog, SafetyFog
const FOG_NODE_COUNT = 3;

function latestGpsByVessel(telemetryEvents) {
  const latest = new Map();
  telemetryEvents
    .filter((event) => event.type === 'gps_track_event')
    .forEach((event) => {
      const existing = latest.get(event.vesselId);
      if (!existing || event.timestamp > existing.timestamp) {
        latest.set(event.vesselId, event);
      }
    });
  return latest;
}

function latestSeaStateByVessel(telemetryEvents) {
  const latest = new Map();
  telemetryEvents
    .filter((event) => event.type === 'sea_state_event')
    .forEach((event) => {
      const existing = latest.get(event.vesselId);
      if (!existing || event.timestamp > existing.timestamp) {
        latest.set(event.vesselId, event);
      }
    });
  return latest;
}

function latestEngineByVessel(telemetryEvents) {
  const latest = new Map();
  telemetryEvents
    .filter((event) => event.type === 'engine_health_event')
    .forEach((event) => {
      const existing = latest.get(event.vesselId);
      if (!existing || event.timestamp > existing.timestamp) {
        latest.set(event.vesselId, event);
      }
    });
  return latest;
}

function buildFleetVesselList(telemetryEvents) {
  const gpsByVessel = latestGpsByVessel(telemetryEvents);
  const seaStateByVessel = latestSeaStateByVessel(telemetryEvents);
  const vesselIds = new Set([...gpsByVessel.keys(), ...seaStateByVessel.keys()]);

  return Array.from(vesselIds).map((vesselId) => {
    const gps = gpsByVessel.get(vesselId);
    const seaState = seaStateByVessel.get(vesselId);
    return {
      vesselId,
      lat: gps ? gps.lat : undefined,
      lon: gps ? gps.lon : undefined,
      seaStateClass: seaState ? seaState.seaStateClass : undefined,
    };
  });
}

// aggregate genuine fleet metrics from the fetched telemetry + alarm feed
function computeFleetMetrics(telemetry, fleetAlarms) {
  const trackedVessels = new Set(telemetry.map((event) => event.vesselId)).size;
  const activeAlarms = fleetAlarms.filter((alarm) => alarm.alarmActive).length;

  const degradedEngines = [...latestEngineByVessel(telemetry).values()]
    .filter((event) => event.degradedBearing).length;

  const roughSeas = [...latestSeaStateByVessel(telemetry).values()]
    .filter((event) => event.seaStateClass === 'ROUGH' || event.seaStateClass === 'SEVERE').length;

  return {
    trackedVessels,
    fogNodes: FOG_NODE_COUNT,
    activeAlarms,
    degradedEngines,
    roughSeas,
  };
}

// reflect the genuine active-alarm count on the Safety & Alarms nav item, not a separate fetch
function updateSafetyNavStatusDot(activeAlarms) {
  const dot = document.getElementById('safety-nav-status-dot');
  if (!dot) return;
  dot.classList.toggle('sidebar-status-dot-alert', activeAlarms > 0);
  const stateLabel = activeAlarms > 0
    ? `${activeAlarms} active alarm${activeAlarms === 1 ? '' : 's'}`
    : 'no active alarms';
  dot.setAttribute('aria-label', stateLabel);
  dot.setAttribute('title', `Red = at least one active vessel alarm; grey = no active alarms (currently ${stateLabel})`);
}

function showEmptyState(message) {
  const note = document.getElementById('fleet-empty-note');
  note.textContent = message;
  note.classList.remove('d-none');

  const emptyMetrics = computeFleetMetrics([], []);
  updateKpiRow(emptyMetrics);
  updateSafetyNavStatusDot(emptyMetrics.activeAlarms);

  const canvas = document.getElementById('fleet-radar-canvas');
  if (canvas) drawRangeRings(canvas);

  const legend = document.getElementById('fleet-radar-legend');
  if (legend) renderFleetRadarLegend(legend, []);

  renderEngineHealthTable(document.getElementById('engine-health-tbody'), []);
  renderSeaStateTable(document.getElementById('sea-state-tbody'), []);
  renderSafetyAlarmsTable(document.getElementById('safety-alarms-tbody'), [], []);
}

// the backend returns raw DynamoDB items with the event fields JSON-encoded in `payload`;
// merge that in so callers can read type/metric fields directly off each entry
function parsePayload(entry) {
  if (!entry || typeof entry.payload !== 'string') return entry;
  try {
    return { ...JSON.parse(entry.payload), ...entry };
  } catch (error) {
    return entry;
  }
}

async function loadDashboard() {
  const client = new HarborPulseApiClient(API_BASE_URL);
  const note = document.getElementById('fleet-empty-note');

  try {
    const summary = await client.getFleetSummary();
    const telemetry = (summary.telemetry || []).map(parsePayload);
    const fleetAlarms = (summary.fleetAlarms || []).map(parsePayload);

    if (telemetry.length === 0 && fleetAlarms.length === 0) {
      showEmptyState('No live telemetry yet — waiting on fog nodes to dispatch fleet data.');
      return;
    }

    note.classList.add('d-none');

    const fleetMetrics = computeFleetMetrics(telemetry, fleetAlarms);
    updateKpiRow(fleetMetrics);
    updateSafetyNavStatusDot(fleetMetrics.activeAlarms);

    const vessels = buildFleetVesselList(telemetry);
    const canvas = document.getElementById('fleet-radar-canvas');
    drawFleetRadar(canvas, vessels);
    renderFleetRadarLegend(document.getElementById('fleet-radar-legend'), vessels);

    const engineEvents = telemetry.filter((event) => event.type === 'engine_health_event');
    renderEngineHealthTable(document.getElementById('engine-health-tbody'), engineEvents);

    const seaStateEvents = telemetry.filter((event) => event.type === 'sea_state_event');
    renderSeaStateTable(document.getElementById('sea-state-tbody'), seaStateEvents);

    renderSafetyAlarmsTable(document.getElementById('safety-alarms-tbody'), fleetAlarms, telemetry);
  } catch (error) {
    showEmptyState('Unable to reach the HarborPulse backend — showing empty console shell.');
  }
}

// sidebar nav scrolls to the matching section and marks it active
function wireNav() {
  const links = document.querySelectorAll('.sidebar-link');
  links.forEach((button) => {
    button.addEventListener('click', () => {
      const target = document.getElementById(button.dataset.target);
      if (target) target.scrollIntoView({ behavior: 'smooth', block: 'start' });
      links.forEach((link) => link.classList.toggle('sidebar-link-active', link === button));
    });
  });
}

// re-poll so the console reflects live fog-node dispatches, not just the page's initial load
const REFRESH_INTERVAL_MS = 5000;

document.addEventListener('DOMContentLoaded', () => {
  renderKpiRow(document.getElementById('fleet-kpi-row'));
  wireNav();
  loadDashboard();
  setInterval(loadDashboard, REFRESH_INTERVAL_MS);
});
