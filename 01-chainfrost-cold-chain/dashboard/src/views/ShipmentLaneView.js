import { getShipmentStatus } from "../api/chainfrostApiClient.js";
import { renderReeferHealthBadge } from "../components/ReeferHealthBadge.js";
import { renderRouteFrostTrail } from "../components/RouteFrostTrail.js";

export async function renderShipmentLaneView(container, shipmentId, onBack) {
  container.innerHTML = `
    <div class="lane-header d-flex align-items-center gap-3 mb-3">
      <button type="button" class="btn btn-outline-secondary btn-sm" data-testid="lane-back">&larr; Back to Manifest</button>
      <h1 class="h5 mb-0">${escapeHtml(shipmentId)}</h1>
    </div>
    <div class="lane-loading text-muted">Pulling shipment lane telemetry&hellip;</div>
  `;

  container.querySelector("[data-testid='lane-back']").addEventListener("click", () => {
    if (typeof onBack === "function") onBack();
  });

  try {
    const status = await getShipmentStatus(shipmentId);
    renderLaneBody(container, status);
  } catch (error) {
    const loading = container.querySelector(".lane-loading");
    if (loading) {
      loading.textContent = `No live data — start the local stack to see readings. (${error.message})`;
      loading.classList.add("text-danger");
    }
  }
}

function renderLaneBody(container, status) {
  const loading = container.querySelector(".lane-loading");
  if (loading) loading.remove();

  const body = document.createElement("div");
  body.className = "lane-body d-flex flex-column gap-4";
  body.setAttribute("data-testid", "lane-body");

  const summary = document.createElement("div");
  summary.className = "card";
  summary.setAttribute("data-testid", "shipment-summary");
  summary.setAttribute("data-severity", status.complianceStatus ?? "OK");
  summary.innerHTML = `
    <div class="card-header">Shipment Summary</div>
    <div class="card-body">
      <div class="info-rows">
        <div class="info-row d-flex gap-2 py-1"><span class="info-row__label text-muted">Truck</span><span class="info-row__value font-monospace">${escapeHtml(status.truckId ?? "--")}</span></div>
        <div class="info-row d-flex gap-2 py-1"><span class="info-row__label text-muted">Humidity</span><span class="info-row__value font-monospace">${formatPercent(status.humidityPct)}</span></div>
        <div class="info-row d-flex gap-2 py-1"><span class="info-row__label text-muted">Compressor Current</span><span class="info-row__value font-monospace">${formatAmps(status.compressorCurrentA)}</span></div>
        <div class="info-row d-flex gap-2 py-1"><span class="info-row__label text-muted">Setpoint</span><span class="info-row__value font-monospace">${formatTemp(status.setpointC)}</span></div>
        <div class="info-row d-flex gap-2 py-1 align-items-center"><span class="info-row__label text-muted">Status</span></div>
      </div>
    </div>
  `;
  summary.querySelector(".info-row:last-child").appendChild(renderReeferHealthBadge(status.complianceStatus ?? "OK"));

  const chartCard = document.createElement("div");
  chartCard.className = "card";
  chartCard.innerHTML = `
    <div class="card-header">Dual Zone Temperature Trend</div>
    <div class="card-body p-0">
      <div class="table-responsive">
        <table class="table table-striped table-hover align-middle mb-0" data-testid="zone-temp-chart">
          <thead>
            <tr>
              <th>#</th>
              <th>Zone A (&deg;C)</th>
              <th>Zone B (&deg;C)</th>
              <th>Setpoint (&deg;C)</th>
            </tr>
          </thead>
          <tbody>
            ${buildTrendRows(status.zoneATempSeries ?? [], status.zoneBTempSeries ?? [], status.setpointC)}
          </tbody>
        </table>
      </div>
    </div>
  `;

  const trailCard = document.createElement("div");
  trailCard.className = "card";
  trailCard.innerHTML = `<div class="card-header">Route Frost Trail</div>`;
  const trailBody = document.createElement("div");
  trailBody.className = "card-body p-0";
  trailBody.appendChild(renderRouteFrostTrail({ points: status.routePoints ?? [] }));
  trailCard.appendChild(trailBody);

  body.appendChild(summary);
  body.appendChild(chartCard);
  body.appendChild(trailCard);
  container.appendChild(body);
}

function buildTrendRows(zoneA, zoneB, setpoint) {
  const rowCount = Math.max(zoneA.length, zoneB.length, 1);
  const rows = [];
  for (let i = 0; i < rowCount; i += 1) {
    rows.push(`
      <tr>
        <td>${i + 1}</td>
        <td>${formatNumber(zoneA[i])}</td>
        <td>${formatNumber(zoneB[i])}</td>
        <td>${formatNumber(setpoint)}</td>
      </tr>
    `);
  }
  return rows.join("");
}

function formatNumber(value) {
  return typeof value === "number" ? value.toFixed(1) : "--";
}

function formatTemp(value) {
  return typeof value === "number" ? `${value.toFixed(1)}°C` : "--°C";
}

function formatPercent(value) {
  return typeof value === "number" ? `${value.toFixed(0)}%` : "--%";
}

function formatAmps(value) {
  return typeof value === "number" ? `${value.toFixed(1)}A` : "--A";
}

function escapeHtml(value) {
  const div = document.createElement("div");
  div.textContent = value ?? "";
  return div.innerHTML;
}
