import { BinSightApiClient } from "./api/binSightApiClient.js";
import { renderDepotBoardStrip, computeDepotStats } from "./components/depotBoardStrip.js";
import { renderBinRiskGrid } from "./components/binRiskGrid.js";
import { renderRoundQueueTable } from "./components/roundQueueTable.js";
import { drawFleetStrip, renderFleetReadouts, KNOWN_BIN_LOCATIONS } from "./components/fleetStripCanvas.js";

const KNOWN_BIN_IDS = ["bin-01", "bin-02", "bin-03"];
const KNOWN_TRUCK_IDS = ["truck-01"];

// no query-string override needed for the CA scope; a single configurable base URL is enough
// to satisfy "config-only swap to real AWS, never the code" for the dashboard's HTTP call.
const API_BASE_URL = window.BINSIGHT_API_BASE_URL ?? "http://localhost:3000";

function showEmptyShellMessage(reason) {
  const statusEl = document.getElementById("bin-risk-grid-status");
  statusEl.innerHTML = `
    <div class="alert alert-secondary mb-3" role="alert">
      No live backend data yet (${reason}). The panels below will populate once
      depot-01's fog nodes start dispatching events.
    </div>
  `;
}

function clearEmptyShellMessage() {
  document.getElementById("bin-risk-grid-status").innerHTML = "";
}

// truck-gps/hopper-fill/fuel-level ride along on FleetNode's work-list event as
// `fleetTelemetry` (see collection-fog's FleetNode.latestFleetTelemetry) rather than as their
// own dispatched event type, so they show up here without a new backend route/table.
function deriveFleetReadout(depotStatus) {
  const telemetry = depotStatus.latestWorkList?.fleetTelemetry;
  return {
    hopperFillPct: telemetry?.hopperFillPct ?? null,
    fuelLevelPct: telemetry?.fuelLevelPct ?? null,
    weighbridgeTonnage: depotStatus.latestWorkList?.latestWeighbridgeTonnage ?? null,
  };
}

function deriveTruckPosition(depotStatus) {
  const pos = depotStatus.latestWorkList?.fleetTelemetry?.lastRecordedPosition;
  if (!pos) return null;
  return { lat: pos.lat, lon: pos.lon, truckId: pos.truckId ?? KNOWN_TRUCK_IDS[0] };
}

function renderPopulated(depotStatus) {
  clearEmptyShellMessage();

  const stats = computeDepotStats(depotStatus, KNOWN_TRUCK_IDS);
  renderDepotBoardStrip(document.getElementById("depot-kpi-row"), stats);

  renderBinRiskGrid(document.getElementById("bin-risk-grid"), KNOWN_BIN_IDS, depotStatus);

  renderRoundQueueTable(document.getElementById("round-queue-body"), depotStatus.latestWorkList);

  const canvas = document.getElementById("fleet-strip-canvas");
  drawFleetStrip(canvas, KNOWN_BIN_LOCATIONS, deriveTruckPosition(depotStatus));
  renderFleetReadouts(document, deriveFleetReadout(depotStatus));
}

function renderEmptyShell(reason) {
  showEmptyShellMessage(reason);

  renderDepotBoardStrip(document.getElementById("depot-kpi-row"), {
    binsDue: 0,
    criticalFireRisk: 0,
    watchFireRisk: 0,
    activeTrucks: 0,
    fogNodes: 3,
  });

  renderBinRiskGrid(document.getElementById("bin-risk-grid"), KNOWN_BIN_IDS, {
    clusterVerdicts: [],
    fireRiskEvents: [],
    latestWorkList: null,
  });

  renderRoundQueueTable(document.getElementById("round-queue-body"), null);

  const canvas = document.getElementById("fleet-strip-canvas");
  drawFleetStrip(canvas, KNOWN_BIN_LOCATIONS, null);
  renderFleetReadouts(document, { hopperFillPct: null, fuelLevelPct: null, weighbridgeTonnage: null });
}

async function bootstrap() {
  const client = new BinSightApiClient(API_BASE_URL);
  try {
    const depotStatus = await client.getDepotStatus();
    renderPopulated(depotStatus);
  } catch (err) {
    renderEmptyShell(err.message ?? "request failed");
  }
}

bootstrap();
