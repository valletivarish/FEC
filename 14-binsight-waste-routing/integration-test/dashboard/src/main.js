import { HarborPulseApiClient } from './api/harborPulseApiClient.js';
import { drawRangeRings, drawFleetRadar, renderFleetRadarLegend } from './components/fleetRadarCanvas.js';
import { renderEngineHealthTable } from './components/engineHealthTable.js';
import { renderSeaStateTable } from './components/seaStateTable.js';
import { renderSafetyAlarmsTable } from './components/safetyAlarmsTable.js';

const API_BASE_URL = window.HARBORPULSE_API_BASE_URL || 'http://localhost:3000';

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

function showEmptyState(message) {
  const note = document.getElementById('fleet-empty-note');
  note.textContent = message;
  note.classList.remove('d-none');

  const canvas = document.getElementById('fleet-radar-canvas');
  if (canvas) drawRangeRings(canvas);

  const legend = document.getElementById('fleet-radar-legend');
  if (legend) renderFleetRadarLegend(legend, []);

  renderEngineHealthTable(document.getElementById('engine-health-tbody'), []);
  renderSeaStateTable(document.getElementById('sea-state-tbody'), []);
  renderSafetyAlarmsTable(document.getElementById('safety-alarms-tbody'), [], []);
}

async function loadDashboard() {
  const client = new HarborPulseApiClient(API_BASE_URL);
  const note = document.getElementById('fleet-empty-note');

  try {
    const summary = await client.getFleetSummary();
    const telemetry = summary.telemetry || [];
    const fleetAlarms = summary.fleetAlarms || [];

    if (telemetry.length === 0 && fleetAlarms.length === 0) {
      showEmptyState('No live telemetry yet — waiting on fog nodes to dispatch fleet data.');
      return;
    }

    note.classList.add('d-none');

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

document.addEventListener('DOMContentLoaded', loadDashboard);
