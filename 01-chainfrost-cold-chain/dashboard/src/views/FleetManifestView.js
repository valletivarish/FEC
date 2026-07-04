import { getFleetHealth } from "../api/chainfrostApiClient.js";
import { renderReeferHealthBadge } from "../components/ReeferHealthBadge.js";
import { renderZoneThermTile } from "../components/ZoneThermTile.js";

// Three fog nodes process this fleet's telemetry: TempFog, ReeferHealthFog, TelematicsFog.
const FOG_NODE_COUNT = 3;

// Renders the manifest table; each row is one shipment/truck pairing.
// onSelectShipment lets main.js own navigation instead of this view knowing about routing.
export async function renderFleetManifestView(container, onSelectShipment) {
  container.innerHTML = `
    <div id="fleet-kpi-row"></div>
    <div class="manifest-header mb-3">
      <p class="text-muted mb-0">Live reefer status across the active fleet &mdash; click a shipment to inspect its cold-chain lane.</p>
    </div>
    <div class="card">
      <div class="card-body">
        <h2 class="panel-heading card-title h6 mb-3">Fleet Manifest</h2>
        <div class="table-responsive">
          <table class="table table-striped table-hover align-middle" data-testid="manifest-list" aria-label="Fleet manifest">
            <thead>
              <tr>
                <th>Shipment</th>
                <th>Truck</th>
                <th>Zone Temp</th>
                <th>Status</th>
                <th>ETA</th>
              </tr>
            </thead>
            <tbody data-testid="manifest-tbody">
              <tr><td colspan="5" class="text-muted">Reading manifest clipboard&hellip;</td></tr>
            </tbody>
          </table>
        </div>
      </div>
    </div>
  `;

  const kpiContainer = container.querySelector("#fleet-kpi-row");
  renderKpiRow(kpiContainer);

  const tbody = container.querySelector("[data-testid='manifest-tbody']");

  try {
    const fleet = await getFleetHealth();
    const shipments = Array.isArray(fleet?.shipments) ? fleet.shipments : Array.isArray(fleet) ? fleet : [];

    updateKpiRow(kpiContainer, shipments);

    if (shipments.length === 0) {
      tbody.innerHTML = `<tr><td colspan="5" class="text-muted">No shipments on the manifest right now.</td></tr>`;
      return;
    }

    tbody.innerHTML = "";
    shipments.forEach((shipment) => {
      tbody.appendChild(buildManifestRow(shipment, onSelectShipment));
    });
  } catch (error) {
    updateKpiRow(kpiContainer, []);
    tbody.innerHTML = `<tr><td colspan="5" class="text-danger" data-testid="manifest-error">No live data — start the local stack to see readings. (${escapeHtml(error.message)})</td></tr>`;
  }
}

// KPI cards start empty; updateKpiRow fills them from the real fleet payload (0 when the stack is down).
function renderKpiRow(container) {
  container.innerHTML = `
    <div class="kpi-row" aria-label="Fleet summary">
      <div class="kpi-card">
        <div>
          <div class="kpi-value"><i class="bi bi-truck kpi-icon"></i><span data-kpi="shipments">0</span></div>
          <div class="kpi-label">Active Shipments</div>
        </div>
      </div>
      <div class="kpi-card">
        <div>
          <div class="kpi-value"><i class="bi bi-hdd-network kpi-icon"></i><span data-kpi="fog-nodes">${FOG_NODE_COUNT}</span></div>
          <div class="kpi-label">Fog Nodes</div>
        </div>
      </div>
      <div class="kpi-card">
        <div>
          <div class="kpi-value"><i class="bi bi-exclamation-triangle kpi-icon"></i><span data-kpi="breaches">0</span></div>
          <div class="kpi-label">Active Breaches</div>
        </div>
      </div>
      <div class="kpi-card">
        <div>
          <div class="kpi-value"><i class="bi bi-thermometer-half kpi-icon"></i><span data-kpi="warnings">0</span></div>
          <div class="kpi-label">Temp Warnings</div>
        </div>
      </div>
    </div>
  `;
}

function updateKpiRow(container, shipments) {
  const breaches = shipments.filter((s) => s.complianceStatus === "BREACH").length;
  const warnings = shipments.filter((s) => s.complianceStatus === "WARN").length;

  container.querySelector('[data-kpi="shipments"]').textContent = String(shipments.length);
  container.querySelector('[data-kpi="breaches"]').textContent = String(breaches);
  container.querySelector('[data-kpi="warnings"]').textContent = String(warnings);
}

function buildManifestRow(shipment, onSelectShipment) {
  const row = document.createElement("tr");
  row.setAttribute("data-testid", "manifest-row");
  row.setAttribute("data-shipment-id", shipment.shipmentId ?? "");
  row.setAttribute("data-severity", shipment.complianceStatus ?? "OK");
  row.style.cursor = "pointer";
  row.tabIndex = 0;

  const idCell = document.createElement("td");
  idCell.setAttribute("data-label", "Shipment");
  idCell.innerHTML = `<span class="fw-semibold">${escapeHtml(shipment.shipmentId ?? "UNKNOWN")}</span>`;

  const truckCell = document.createElement("td");
  truckCell.setAttribute("data-label", "Truck");
  truckCell.textContent = shipment.truckId ?? "";

  const tempCell = document.createElement("td");
  tempCell.setAttribute("data-label", "Zone Temp");
  tempCell.appendChild(
    renderZoneThermTile({
      label: "Zone Temp",
      celsius: shipment.zoneTempC,
      setpoint: shipment.setpointC,
      sparkline: shipment.zoneTempSparkline,
    })
  );

  const statusCell = document.createElement("td");
  statusCell.setAttribute("data-label", "Status");
  statusCell.appendChild(renderReeferHealthBadge(shipment.complianceStatus ?? "OK"));

  const etaCell = document.createElement("td");
  etaCell.setAttribute("data-label", "ETA");
  etaCell.textContent = shipment.etaLabel ?? "--";

  row.appendChild(idCell);
  row.appendChild(truckCell);
  row.appendChild(tempCell);
  row.appendChild(statusCell);
  row.appendChild(etaCell);

  const activate = () => {
    if (typeof onSelectShipment === "function") {
      onSelectShipment(shipment.shipmentId);
    }
  };
  row.addEventListener("click", activate);
  row.addEventListener("keydown", (event) => {
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      activate();
    }
  });

  return row;
}

function escapeHtml(value) {
  const div = document.createElement("div");
  div.textContent = value ?? "";
  return div.innerHTML;
}
