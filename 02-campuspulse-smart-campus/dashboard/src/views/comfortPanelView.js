import { getZoneStatus, getZoneHistory } from '../apiClient.js';

// Comfort bands loosen when a zone is unoccupied - avoids false WARN overnight.
const THRESHOLDS = {
  occupied: {
    temperature: { min: 19, max: 25 },
    humidity: { min: 30, max: 60 },
    'light-lux': { min: 200, max: 1000 },
    co2: { min: 400, max: 1000 },
  },
  vacant: {
    temperature: { min: 15, max: 28 },
    humidity: { min: 20, max: 70 },
    'light-lux': { min: 0, max: 1200 },
    co2: { min: 400, max: 1500 },
  },
};

function bandFor(topic, occupied) {
  const set = occupied ? THRESHOLDS.occupied : THRESHOLDS.vacant;
  return set[topic];
}

function statusFor(topic, value, occupied) {
  const band = bandFor(topic, occupied);
  if (value == null || !band) return 'unknown';
  if (value < band.min || value > band.max) return 'out-of-range';
  return 'ok';
}

function badgeClass(status) {
  if (status === 'ok') return 'text-bg-success';
  if (status === 'out-of-range') return 'text-bg-warning';
  return 'text-bg-secondary';
}

function metricRow(label, topic, value, unit, occupied) {
  const status = statusFor(topic, value, occupied);
  const display = value != null ? `${value} ${unit}` : 'no data';
  return `
    <tr>
      <td>${label}</td>
      <td class="num">${display}</td>
      <td><span class="badge rounded-pill ${badgeClass(status)}">${status.replace('-', ' ')}</span></td>
    </tr>
  `;
}

// Comfort Glass ring: arc length encodes occupancy, fill color encodes worst comfort
// status, and the gap left before the arc closes is the FSM interrupt (closes = armed,
// glows copper = alert). The outer tick-arc pulls in the zone's kWh load so all three
// fog nodes (comfort, security via occupancy, energy via the tick) converge in one ring.
const OCCUPIED_ARC_DEG = 300;
const VACANT_ARC_DEG = 70;
const MAX_GAP_DEG = 40;
const ARMED_GAP_DEG = 6;
const MAX_KWH_FOR_TICK = 10;

function worstStatus(statuses) {
  if (statuses.includes('out-of-range')) return 'out-of-range';
  if (statuses.includes('unknown')) return 'unknown';
  return 'ok';
}

function ringColorFor(status) {
  if (status === 'out-of-range') return 'var(--cp-glass-alert)';
  if (status === 'unknown') return 'rgba(237, 239, 242, 0.4)';
  return 'var(--cp-glass-comfort)';
}

function bindComfortRing(ring, { occupied, status, kwh }) {
  const arcDeg = occupied ? OCCUPIED_ARC_DEG : VACANT_ARC_DEG;
  const gapDeg = status === 'out-of-range' ? ARMED_GAP_DEG : MAX_GAP_DEG;
  const kwhDeg = Math.max(0, Math.min(1, (kwh || 0) / MAX_KWH_FOR_TICK)) * 360;

  ring.style.setProperty('--ring-arc', `${arcDeg}deg`);
  ring.style.setProperty('--ring-gap', `${gapDeg}deg`);
  ring.style.setProperty('--ring-color', ringColorFor(status));
  ring.style.setProperty('--kwh-arc', `${kwhDeg}deg`);
  ring.classList.toggle('is-alert', status === 'out-of-range');
}

export async function renderComfortPanelView(container, zoneId) {
  container.innerHTML = `
    <section class="section comfort-panel card" aria-label="Comfort panel">
      <div class="card-body">
        <h2 class="panel-heading card-title h6 text-uppercase text-muted">Comfort / ${zoneId}</h2>
        <div class="comfort-ring-wrap">
          <div class="comfort-ring" id="comfort-ring" role="img" aria-label="Comfort glass ring">
            <div class="comfort-ring-label">
              <span class="comfort-ring-value" id="comfort-ring-value">--</span>
              <span class="comfort-ring-caption">occupancy</span>
            </div>
          </div>
          <div class="comfort-ring-legend">
            <span><span class="swatch" style="background: var(--cp-glass-comfort);"></span>Comfort nominal</span>
            <span><span class="swatch" style="background: var(--cp-glass-alert);"></span>Out of range (armed gap closes)</span>
            <span><span class="swatch" style="background: var(--cp-glass-energy);"></span>kWh load (outer tick)</span>
          </div>
        </div>
        <div class="table-responsive">
          <table class="table table-striped table-hover align-middle">
            <thead>
              <tr>
                <th scope="col">Metric</th>
                <th scope="col">Value</th>
                <th scope="col">Status</th>
              </tr>
            </thead>
            <tbody id="comfort-metrics">
              <tr><td colspan="3" class="empty-note text-muted">Loading...</td></tr>
            </tbody>
          </table>
        </div>
        <p id="occupancy-note" class="occupancy-note text-muted small mb-0"></p>
      </div>
    </section>
  `;

  const [status, motionHistory, electricityHistory] = await Promise.all([
    getZoneStatus(zoneId).catch(() => ({})),
    getZoneHistory(zoneId, 'motion').catch(() => ({ readings: [] })),
    getZoneHistory(zoneId, 'electricity').catch(() => ({ readings: [] })),
  ]);

  const recentMotion = (motionHistory.readings || []).slice(-1)[0];
  const occupied = recentMotion ? recentMotion.value === 1 : true;

  const recentKwh = (electricityHistory.readings || []).slice(-1)[0];
  const kwh = recentKwh ? recentKwh.value : 0;

  const rowStatuses = [
    statusFor('temperature', status.temperature, occupied),
    statusFor('humidity', status.humidity, occupied),
    statusFor('light-lux', status.lightLux, occupied),
    statusFor('co2', status.co2, occupied),
  ];
  const overallStatus = worstStatus(rowStatuses);

  const metrics = container.querySelector('#comfort-metrics');
  metrics.innerHTML = [
    metricRow('Temperature', 'temperature', status.temperature, 'C', occupied),
    metricRow('Humidity', 'humidity', status.humidity, '%RH', occupied),
    metricRow('Light', 'light-lux', status.lightLux, 'lux', occupied),
    metricRow('CO2', 'co2', status.co2, 'ppm', occupied),
  ].join('');

  container.querySelector('#occupancy-note').textContent = `Occupancy inferred: ${occupied ? 'occupied' : 'vacant'}`;

  const ring = container.querySelector('#comfort-ring');
  bindComfortRing(ring, { occupied, status: overallStatus, kwh });
  container.querySelector('#comfort-ring-value').textContent = occupied ? 'OCCUPIED' : 'VACANT';
}
