import { getZoneHistory } from "../api.js";
import { renderSparkline } from "../components/trend-sparkline.js";

// Order and units mirror the shared MQTT topic contract so labels never drift from sensor semantics.
const SENSOR_DEFS = [
  { key: "co2", label: "CO2", unit: "ppm" },
  { key: "pm25", label: "PM2.5", unit: "µg/m³" },
  { key: "pm10", label: "PM10", unit: "µg/m³" },
  { key: "tvoc", label: "TVOC", unit: "ppb" },
  { key: "temperature", label: "Temperature", unit: "°C" },
  { key: "humidity", label: "Humidity", unit: "%RH" },
  { key: "co", label: "CO", unit: "ppm" },
  { key: "no2", label: "NO2", unit: "ppb" },
  { key: "hcho", label: "HCHO", unit: "ppb" },
  { key: "occupancy_pir", label: "Occupancy", unit: "" },
];

const GAS_RATE_SENSORS = ["co2", "tvoc", "co", "no2"];

// Real backend shape (see backend/functions/zone_query/handler.py) is { zone_id, events: [...] },
// a flat list of per-sensor advisory events in ascending timestamp order - not a { series: {...} } map.
function extractSeries(history, key) {
  const events = Array.isArray(history?.events) ? history.events : [];
  return events.filter((item) => item.sensor === key).map((item) => Number(item.value));
}

function sensorRowMarkup(def, values) {
  const latest = values.length ? values[values.length - 1] : "–";
  return `
    <tr class="sensor-row">
      <td>${def.label}</td>
      <td class="num">${latest}</td>
      <td>${def.unit}</td>
      <td>${renderSparkline(values, { width: 160, height: 28 })}</td>
    </tr>
  `;
}


// EWMA smooths gas readings so rate-of-rise spikes stand out against sensor noise.
function computeEwma(values, alpha = 0.3) {
  if (!values.length) return [];
  const out = [values[0]];
  for (let i = 1; i < values.length; i += 1) {
    out.push(alpha * values[i] + (1 - alpha) * out[i - 1]);
  }
  return out;
}

function detectRiseEvents(values, threshold = 0.08) {
  const events = [];
  for (let i = 1; i < values.length; i += 1) {
    const prev = values[i - 1] || 1;
    if ((values[i] - values[i - 1]) / prev > threshold) {
      events.push(i);
    }
  }
  return events;
}

function gasRatePanelMarkup(history) {
  const rows = GAS_RATE_SENSORS.map((key) => {
    const raw = extractSeries(history, key);
    const ewma = computeEwma(raw);
    const events = detectRiseEvents(raw);
    return `
      <tr>
        <td>${key.toUpperCase()}</td>
        <td>${renderSparkline(ewma, { width: 220, height: 24 })}</td>
        <td class="num">${events.length}</td>
      </tr>
    `;
  }).join("");

  return `
    <div class="card mb-3">
      <div class="card-header">Gas Rate-of-Rise</div>
      <div class="card-body">
        <div class="table-responsive">
          <table class="table table-striped table-hover align-middle mb-0">
            <thead><tr><th>Sensor</th><th title="Smoothed short-term trend in gas concentration -- rising means levels are climbing">EWMA trend</th><th>Rise events</th></tr></thead>
            <tbody>${rows}</tbody>
          </table>
        </div>
      </div>
    </div>
  `;
}

function comfortOccupancyStripMarkup(history) {
  // Comfort advisories are stored under sensor: "comfort" (see fog/fog_comfort.py), not "comfort_index".
  const comfort = extractSeries(history, "comfort");
  const occupancy = extractSeries(history, "occupancy_pir");
  const occupiedSamples = occupancy.filter((v) => v).length;

  return `
    <div class="card mb-3">
      <div class="card-header">Comfort &amp; Occupancy</div>
      <div class="card-body">
        <div class="table-responsive">
          <table class="table table-striped table-hover align-middle mb-0">
            <tbody>
              <tr><td>Comfort index trend</td><td>${renderSparkline(comfort, { width: 220, height: 24 })}</td></tr>
              <tr><td>Occupied samples</td><td class="num">${occupiedSamples} / ${occupancy.length}</td></tr>
            </tbody>
          </table>
        </div>
      </div>
    </div>
  `;
}

// Renders the full zone-detail view: 10 per-sensor rows, the gas rate-of-rise panel, and comfort strip.
export async function renderZoneDetail(container, zoneId, { onBack, onOpenConfig } = {}) {
  container.innerHTML = `<div class="view__loading">Loading ${zoneId}…</div>`;

  const history = await getZoneHistory(zoneId).catch(() => ({}));

  const sensorRows = SENSOR_DEFS.map((def) => sensorRowMarkup(def, extractSeries(history, def.key))).join("");

  container.innerHTML = `
    <div class="zone-detail">
      <div class="toolbar d-flex align-items-center justify-content-between gap-3 mb-3">
        <button type="button" class="btn btn-outline-secondary" data-action="back">&larr; VentBoard</button>
        <h2 class="toolbar__title h5 mb-0">${zoneId}</h2>
        <button type="button" class="btn btn-primary" data-action="config">Zone Config</button>
      </div>
      <div class="card mb-3">
        <div class="card-header">Sensor Readings</div>
        <div class="card-body">
          <div class="table-responsive">
            <table class="table table-striped table-hover align-middle sensor-table mb-0">
              <thead><tr><th>Sensor</th><th>Value</th><th>Unit</th><th>Trend</th></tr></thead>
              <tbody>${sensorRows}</tbody>
            </table>
          </div>
        </div>
      </div>
      ${gasRatePanelMarkup(history)}
      ${comfortOccupancyStripMarkup(history)}
    </div>
  `;

  container.querySelector('[data-action="back"]')?.addEventListener("click", () => onBack?.());
  container.querySelector('[data-action="config"]')?.addEventListener("click", () => onOpenConfig?.(zoneId));
}
