// home port fixed near the middle of the sensor lat/lon box (lat 53.34-53.36, lon -6.28 to -6.24)
export const HOME_PORT = { lat: 53.35, lon: -6.26 };

const RADAR_MAX_RANGE_METERS = 4000;

const SEA_STATE_COLORS = {
  CALM: '#4caf7d',
  LIGHT: '#7fb8d9',
  MODERATE: '#c9a45c',
  ROUGH: '#d97b3f',
  SEVERE: '#d94f4f',
  UNKNOWN: '#8a97a3',
};

// real haversine distance in meters
function haversineDistanceMeters(from, to) {
  const earthRadiusM = 6371000;
  const toRad = (deg) => (deg * Math.PI) / 180;
  const dLat = toRad(to.lat - from.lat);
  const dLon = toRad(to.lon - from.lon);
  const lat1 = toRad(from.lat);
  const lat2 = toRad(to.lat);
  const a =
    Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon / 2) ** 2;
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return earthRadiusM * c;
}

// bearing in degrees, 0 = north, clockwise
function bearingDegrees(from, to) {
  const toRad = (deg) => (deg * Math.PI) / 180;
  const toDeg = (rad) => (rad * 180) / Math.PI;
  const lat1 = toRad(from.lat);
  const lat2 = toRad(to.lat);
  const dLon = toRad(to.lon - from.lon);
  const y = Math.sin(dLon) * Math.cos(lat2);
  const x = Math.cos(lat1) * Math.sin(lat2) - Math.sin(lat1) * Math.cos(lat2) * Math.cos(dLon);
  const bearing = toDeg(Math.atan2(y, x));
  return (bearing + 360) % 360;
}

export function getSeaStateColor(seaStateClass) {
  return SEA_STATE_COLORS[seaStateClass] || SEA_STATE_COLORS.UNKNOWN;
}

export function drawRangeRings(canvas) {
  const ctx = canvas.getContext('2d');
  const w = canvas.width;
  const h = canvas.height;
  const cx = w / 2;
  const cy = h / 2;
  const maxRadius = Math.min(w, h) / 2 - 20;

  ctx.clearRect(0, 0, w, h);
  ctx.fillStyle = '#08161f';
  ctx.fillRect(0, 0, w, h);

  ctx.strokeStyle = 'rgba(201, 164, 92, 0.35)';
  ctx.lineWidth = 1;
  const ringCount = 4;
  for (let i = 1; i <= ringCount; i += 1) {
    const radius = (maxRadius / ringCount) * i;
    ctx.beginPath();
    ctx.arc(cx, cy, radius, 0, Math.PI * 2);
    ctx.stroke();
  }

  ctx.strokeStyle = 'rgba(201, 164, 92, 0.2)';
  ctx.beginPath();
  ctx.moveTo(cx, cy - maxRadius);
  ctx.lineTo(cx, cy + maxRadius);
  ctx.moveTo(cx - maxRadius, cy);
  ctx.lineTo(cx + maxRadius, cy);
  ctx.stroke();

  ctx.fillStyle = '#c9a45c';
  ctx.beginPath();
  ctx.arc(cx, cy, 4, 0, Math.PI * 2);
  ctx.fill();

  ctx.font = '11px monospace';
  ctx.fillStyle = 'rgba(233, 236, 239, 0.6)';
  ctx.fillText('N', cx - 4, cy - maxRadius - 6);
  ctx.fillText('HOME', cx + 8, cy - 4);

  return { cx, cy, maxRadius };
}

export function drawFleetRadar(canvas, vessels) {
  const { cx, cy, maxRadius } = drawRangeRings(canvas);
  const ctx = canvas.getContext('2d');

  vessels.forEach((vessel) => {
    if (!vessel.lat == null || vessel.lat === undefined || vessel.lon === undefined) return;
    const distanceMeters = haversineDistanceMeters(HOME_PORT, { lat: vessel.lat, lon: vessel.lon });
    const bearing = bearingDegrees(HOME_PORT, { lat: vessel.lat, lon: vessel.lon });
    const rangeFraction = Math.min(distanceMeters / RADAR_MAX_RANGE_METERS, 1);
    const radius = rangeFraction * maxRadius;
    const angleRad = ((bearing - 90) * Math.PI) / 180;
    const x = cx + radius * Math.cos(angleRad);
    const y = cy + radius * Math.sin(angleRad);

    ctx.fillStyle = getSeaStateColor(vessel.seaStateClass);
    ctx.beginPath();
    ctx.arc(x, y, 6, 0, Math.PI * 2);
    ctx.fill();

    ctx.strokeStyle = 'rgba(11, 31, 46, 0.8)';
    ctx.lineWidth = 1.5;
    ctx.stroke();

    ctx.font = '10px monospace';
    ctx.fillStyle = '#e9ecef';
    ctx.fillText(vessel.vesselId, x + 8, y + 3);
  });
}

export function createFleetRadarCanvas() {
  const wrapper = document.createElement('div');
  wrapper.className = 'd-flex flex-wrap align-items-start gap-3';

  const canvas = document.createElement('canvas');
  canvas.id = 'fleet-radar-canvas';
  canvas.width = 360;
  canvas.height = 360;
  canvas.className = 'border border-secondary-subtle rounded';

  const legend = document.createElement('div');
  legend.id = 'fleet-radar-legend';
  legend.className = 'radar-legend';

  wrapper.appendChild(canvas);
  wrapper.appendChild(legend);
  return wrapper;
}

export function renderFleetRadarLegend(legendEl, vessels) {
  legendEl.innerHTML = '';
  const title = document.createElement('div');
  title.className = 'fw-semibold mb-2 text-uppercase small text-brass';
  title.textContent = 'Fleet Legend';
  legendEl.appendChild(title);

  vessels.forEach((vessel) => {
    const row = document.createElement('div');
    row.className = 'd-flex align-items-center gap-2 mb-1 legend-row';

    const swatch = document.createElement('span');
    swatch.className = 'legend-swatch';
    swatch.style.backgroundColor = getSeaStateColor(vessel.seaStateClass);

    const label = document.createElement('span');
    label.className = 'legend-label font-monospace';
    label.textContent = `${vessel.vesselId} — ${vessel.seaStateClass || 'UNKNOWN'}`;

    row.appendChild(swatch);
    row.appendChild(label);
    legendEl.appendChild(row);
  });
}
