import { getZoneStatus } from "../api.js";
import { resolveBand } from "../lib/aqi-bands.js";

// Zone catalogue lives client-side since the API is per-zone; ids must match the zone_id
// each sensor rig publishes under (sensors/profiles/*.yaml), not an invented label set.
const KNOWN_ZONES = [
  { id: "zone-default", label: "Default Zone" },
  { id: "zone-server-room", label: "Server Room" },
  { id: "zone-meeting-room", label: "Meeting Room" },
];

// Fixed platform facts: 10 sensor types per zone, 3 fog nodes processing them.
const SENSOR_TYPE_COUNT = 10;
const FOG_NODE_COUNT = 3;

// Advisory-worthy bands are anything past the two healthy tiers - matches the fog nodes' advisory trigger.
const ADVISORY_BANDS = new Set(["elevated", "unhealthy", "hazardous"]);

// Order defines "worst wins" when reducing several per-sensor bands down to one zone-level badge.
const BAND_SEVERITY = ["good", "moderate", "unhealthy_sensitive", "elevated", "unhealthy", "very_unhealthy", "hazardous"];

// Real backend shape (see backend/functions/zone_query/handler.py) is { zone_id, sensors: [...] },
// one latest-reading-or-advisory item per sensor - not a flat status object with band/comfort_index/occupied.
function summarizeZoneStatus(payload) {
  const sensors = Array.isArray(payload?.sensors) ? payload.sensors : [];
  if (!sensors.length) return null;

  const worstBand = sensors.reduce((worst, item) => {
    if (!item.band) return worst;
    const rank = BAND_SEVERITY.indexOf(item.band);
    const worstRank = BAND_SEVERITY.indexOf(worst);
    return rank > worstRank ? item.band : worst;
  }, "good");

  const occupancyItem = sensors.find((item) => item.sensor === "occupancy_pir");
  const occupied = occupancyItem ? Boolean(Number(occupancyItem.value)) : false;

  // Comfort is only ever emitted as an advisory value on the "comfort" pseudo-sensor (0-100 scale).
  const comfortItem = sensors.find((item) => item.sensor === "comfort");
  const comfortIndex = comfortItem ? Number(comfortItem.value) : null;

  return { band: worstBand, occupied, comfortIndex };
}

function kpiRowMarkup() {
  return `
    <div class="kpi-row" aria-label="Air quality summary">
      <div class="kpi-card">
        <span class="kpi-icon kpi-icon-blue"><i class="bi bi-diagram-3"></i></span>
        <div class="kpi-value" data-kpi="zones">${KNOWN_ZONES.length}</div>
        <div class="kpi-label">Zones Monitored</div>
      </div>
      <div class="kpi-card">
        <span class="kpi-icon kpi-icon-green"><i class="bi bi-wind"></i></span>
        <div class="kpi-value" data-kpi="sensors">${SENSOR_TYPE_COUNT}</div>
        <div class="kpi-label">Sensor Types</div>
      </div>
      <div class="kpi-card">
        <span class="kpi-icon kpi-icon-blue"><i class="bi bi-hdd-network"></i></span>
        <div class="kpi-value" data-kpi="fog-nodes">${FOG_NODE_COUNT}</div>
        <div class="kpi-label">Fog Nodes</div>
      </div>
      <div class="kpi-card">
        <span class="kpi-icon kpi-icon-red"><i class="bi bi-exclamation-triangle"></i></span>
        <div class="kpi-value" data-kpi="advisories">--</div>
        <div class="kpi-label">Active Advisories</div>
      </div>
      <div class="kpi-card">
        <span class="kpi-icon kpi-icon-amber"><i class="bi bi-people"></i></span>
        <div class="kpi-value" data-kpi="occupied">--</div>
        <div class="kpi-label">Occupied Zones</div>
      </div>
    </div>
  `;
}

// Aggregates computed from the real fetched summaries; a zone with no payload counts toward neither total.
function updateKpiRow(container, summaries) {
  const live = summaries.filter(Boolean);
  const advisories = live.filter((s) => {
    const band = resolveBand(s.band ?? "good");
    return ADVISORY_BANDS.has(band.id);
  }).length;
  const occupied = live.filter((s) => s.occupied).length;

  container.querySelector('[data-kpi="advisories"]').textContent = String(advisories);
  container.querySelector('[data-kpi="occupied"]').textContent = String(occupied);
}

// One KPI tile per zone: band badge up top, comfort index + occupancy as large bold numbers underneath.
function zoneTileMarkup(zone, summary) {
  // No sensors reporting means the fog node never sent anything for this zone - show that plainly rather than faking a "good" band.
  if (!summary) {
    return `
      <div class="col">
        <div class="card zone-tile h-100" data-zone-id="${zone.id}" tabindex="0" role="button"
          aria-label="Open detail for ${zone.label}">
          <div class="card-body d-flex flex-column">
            <div class="d-flex align-items-start justify-content-between mb-2">
              <h2 class="zone-tile__title h6 mb-0">${zone.label}</h2>
              <span class="badge rounded-pill text-bg-secondary">Unknown</span>
            </div>
            <div class="zone-tile__metrics row row-cols-2 g-2 mt-auto">
              <div class="col">
                <div class="zone-tile__metric-value">–</div>
                <div class="zone-tile__metric-label">Comfort</div>
              </div>
              <div class="col">
                <span class="badge rounded-pill text-bg-secondary">Offline</span>
                <div class="zone-tile__metric-label">Occupancy</div>
              </div>
            </div>
          </div>
        </div>
      </div>
    `;
  }

  const band = resolveBand(summary.band ?? "good");
  const occupied = summary.occupied;
  const comfortDisplay = summary.comfortIndex === null ? "–" : Math.round(summary.comfortIndex);

  return `
    <div class="col">
      <div class="card zone-tile h-100" data-zone-id="${zone.id}" tabindex="0" role="button"
        aria-label="Open detail for ${zone.label}">
        <div class="card-body d-flex flex-column">
          <div class="d-flex align-items-start justify-content-between mb-2">
            <h2 class="zone-tile__title h6 mb-0">${zone.label}</h2>
            <span class="badge rounded-pill ${band.badgeClass}">${band.label}</span>
          </div>
          <div class="zone-tile__metrics row row-cols-2 g-2 mt-auto">
            <div class="col">
              <div class="zone-tile__metric-value">${comfortDisplay}</div>
              <div class="zone-tile__metric-label">Comfort</div>
            </div>
            <div class="col">
              <span class="badge rounded-pill ${occupied ? "text-bg-success" : "text-bg-secondary"}">${occupied ? "Occupied" : "Vacant"}</span>
              <div class="zone-tile__metric-label">Occupancy</div>
            </div>
          </div>
        </div>
      </div>
    </div>
  `;
}

// Renders the VentBoard overview into the given container and wires tile click/keyboard navigation.
export async function renderVentBoardGrid(container, { onSelectZone } = {}) {
  container.innerHTML = `
    ${kpiRowMarkup()}
    <div class="ventboard-grid" aria-busy="true">Loading zones…</div>
  `;

  const results = await Promise.allSettled(
    KNOWN_ZONES.map((zone) => getZoneStatus(zone.id).then((payload) => ({ zone, payload })))
  );

  const summaries = results.map((result) =>
    result.status === "fulfilled" ? summarizeZoneStatus(result.value.payload) : null
  );

  const tiles = summaries
    .map((summary, index) => zoneTileMarkup(KNOWN_ZONES[index], summary))
    .join("");

  // All zones unreachable almost always means the local stack isn't running - say so instead of a bare fetch error.
  const allFailed = results.every((result) => result.status === "rejected");
  const noticeMarkup = allFailed
    ? `<div class="alert alert-secondary" role="status">No live data — start the local stack to see readings.</div>`
    : "";

  container.innerHTML = `
    ${kpiRowMarkup()}
    ${noticeMarkup}
    <div class="row row-cols-1 row-cols-md-3 g-3 ventboard-grid">${tiles}</div>
  `;

  updateKpiRow(container, summaries);

  container.querySelectorAll(".zone-tile").forEach((tile) => {
    const zoneId = tile.dataset.zoneId;
    const open = () => onSelectZone?.(zoneId);
    tile.addEventListener("click", open);
    tile.addEventListener("keydown", (event) => {
      if (event.key === "Enter" || event.key === " ") {
        event.preventDefault();
        open();
      }
    });
  });
}

export { KNOWN_ZONES };
