import { getActiveAlerts, getZoneStatus } from '../apiClient.js';
import { getState, setSelectedZone } from '../state.js';

// BREACH outranks WARN outranks INFO/nominal - a zone shows its worst active condition.
const SEVERITY_RANK = { BREACH: 3, WARN: 2, INFO: 1 };

function worstSeverity(alerts) {
  return alerts.reduce((worst, alert) => {
    const rank = SEVERITY_RANK[alert.severity] || 0;
    return rank > (SEVERITY_RANK[worst] || 0) ? alert.severity : worst;
  }, null);
}

function badgeClass(severity) {
  if (severity === 'BREACH') return 'text-bg-danger';
  if (severity === 'WARN') return 'text-bg-warning';
  return 'text-bg-success';
}

function statusLabel(severity) {
  return severity || 'NOMINAL';
}

async function loadRowData(zoneId) {
  const [status, alertsResponse] = await Promise.all([
    getZoneStatus(zoneId).catch(() => null),
    getActiveAlerts().catch(() => ({ alerts: [] })),
  ]);
  const zoneAlerts = (alertsResponse.alerts || []).filter((alert) => alert.zoneId === zoneId);
  return { status, severity: worstSeverity(zoneAlerts), alertCount: zoneAlerts.length };
}

function buildRow(zoneId, onSelect) {
  const row = document.createElement('tr');
  row.dataset.zoneId = zoneId;
  row.innerHTML = `
    <td><button class="zone-row-btn btn btn-link p-0" type="button">${zoneId}</button></td>
    <td class="num" data-field="temperature">--</td>
    <td class="num" data-field="humidity">--</td>
    <td class="num" data-field="co2">--</td>
    <td class="num" data-field="occupancy">--</td>
    <td data-field="status"><span class="badge rounded-pill text-bg-success">NOMINAL</span></td>
  `;
  row.querySelector('.zone-row-btn').addEventListener('click', () => onSelect(zoneId));
  return row;
}

function applyRowData(row, data) {
  const severity = data.severity;
  const status = data.status || {};
  row.querySelector('[data-field="temperature"]').textContent = status.temperature != null ? `${status.temperature} C` : 'no data';
  row.querySelector('[data-field="humidity"]').textContent = status.humidity != null ? `${status.humidity} %RH` : 'no data';
  row.querySelector('[data-field="co2"]').textContent = status.co2 != null ? `${status.co2} ppm` : 'no data';
  row.querySelector('[data-field="occupancy"]').textContent = data.alertCount > 0 ? String(data.alertCount) : '0';

  const statusCell = row.querySelector('[data-field="status"]');
  statusCell.innerHTML = `<span class="badge rounded-pill ${badgeClass(severity)}">${statusLabel(severity)}</span>`;
}

function renderKpiRow(container, zoneCount) {
  container.innerHTML = `
    <div class="kpi-row" aria-label="Building summary">
      <div class="kpi-card">
        <span class="kpi-icon kpi-icon-blue"><i class="bi bi-grid-1x2"></i></span>
        <div>
          <div class="kpi-value" data-kpi="zones">${zoneCount}</div>
          <div class="kpi-label">Zones Monitored</div>
        </div>
      </div>
      <div class="kpi-card">
        <span class="kpi-icon kpi-icon-red"><i class="bi bi-exclamation-triangle"></i></span>
        <div>
          <div class="kpi-value" data-kpi="active-alerts">--</div>
          <div class="kpi-label">Active Alerts</div>
        </div>
      </div>
      <div class="kpi-card">
        <span class="kpi-icon kpi-icon-amber"><i class="bi bi-shield-exclamation"></i></span>
        <div>
          <div class="kpi-value" data-kpi="breach-zones">--</div>
          <div class="kpi-label">Zones in Breach</div>
        </div>
      </div>
      <div class="kpi-card">
        <span class="kpi-icon kpi-icon-green"><i class="bi bi-check-circle"></i></span>
        <div>
          <div class="kpi-value" data-kpi="nominal-zones">--</div>
          <div class="kpi-label">Nominal Zones</div>
        </div>
      </div>
    </div>
  `;
}

function updateKpiRow(container, rowDataByZone) {
  const values = [...rowDataByZone.values()];
  const activeAlerts = values.reduce((sum, data) => sum + (data.alertCount || 0), 0);
  const breachZones = values.filter((data) => data.severity === 'BREACH').length;
  const nominalZones = values.filter((data) => !data.severity).length;

  container.querySelector('[data-kpi="active-alerts"]').textContent = String(activeAlerts);
  container.querySelector('[data-kpi="breach-zones"]').textContent = String(breachZones);
  container.querySelector('[data-kpi="nominal-zones"]').textContent = String(nominalZones);

  // Sidebar nav badge mirrors this same aggregate - one source of truth for "active alerts".
  const navBadge = document.getElementById('alert-feed-count');
  if (navBadge) {
    navBadge.textContent = String(activeAlerts);
    navBadge.hidden = activeAlerts === 0;
  }
}

export function renderZoneGridView(container, onZoneSelected) {
  container.innerHTML = `
    <div id="zone-kpi-row"></div>
    <section class="section zone-grid-panel card" aria-label="Zone status">
      <div class="card-body">
        <h2 class="panel-heading card-title h6">Zones</h2>
        <div class="table-responsive">
          <table class="table table-striped table-hover align-middle">
            <thead>
              <tr>
                <th scope="col">Zone</th>
                <th scope="col">Temp (C)</th>
                <th scope="col">Humidity (%RH)</th>
                <th scope="col">CO2 (ppm)</th>
                <th scope="col">Active Alerts</th>
                <th scope="col">Status</th>
              </tr>
            </thead>
            <tbody id="zone-grid"></tbody>
          </table>
        </div>
      </div>
    </section>
  `;

  const { zones } = getState();
  const kpiContainer = container.querySelector('#zone-kpi-row');
  renderKpiRow(kpiContainer, zones.length);

  const grid = container.querySelector('#zone-grid');
  const rows = new Map();
  const rowDataByZone = new Map();

  zones.forEach((zoneId) => {
    const row = buildRow(zoneId, (id) => {
      setSelectedZone(id);
      if (onZoneSelected) onZoneSelected(id);
    });
    grid.appendChild(row);
    rows.set(zoneId, row);
  });

  Promise.all(
    zones.map(async (zoneId) => {
      const data = await loadRowData(zoneId);
      rowDataByZone.set(zoneId, data);
      const row = rows.get(zoneId);
      if (row) applyRowData(row, data);
    })
  ).then(() => updateKpiRow(kpiContainer, rowDataByZone));
}
