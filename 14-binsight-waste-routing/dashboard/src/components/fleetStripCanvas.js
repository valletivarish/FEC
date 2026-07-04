// bins are stationary, so their plot coordinates are a fixed local reference — not part of
// the depot-status payload, which only carries fog-dispatched events, not raw entity locations.
export const KNOWN_BIN_LOCATIONS = {
  "bin-01": { lat: 53.3492, lon: -6.2661 },
  "bin-02": { lat: 53.3508, lon: -6.2617 },
  "bin-03": { lat: 53.3475, lon: -6.2589 },
};

const DEPOT_AREA_BOUNDS = { latMin: 53.34, latMax: 53.36, lonMin: -6.28, lonMax: -6.24 };

function project(lat, lon, canvasWidth, canvasHeight) {
  const { latMin, latMax, lonMin, lonMax } = DEPOT_AREA_BOUNDS;
  const x = ((lon - lonMin) / (lonMax - lonMin)) * canvasWidth;
  const y = canvasHeight - ((lat - latMin) / (latMax - latMin)) * canvasHeight;
  return { x, y };
}

export function drawFleetStrip(canvas, binLocations, truckPosition) {
  const ctx = canvas.getContext("2d");
  const { width, height } = canvas;
  ctx.clearRect(0, 0, width, height);

  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, width, height);

  ctx.strokeStyle = "#eef0f3";
  for (let gx = 0; gx <= width; gx += 40) {
    ctx.beginPath();
    ctx.moveTo(gx, 0);
    ctx.lineTo(gx, height);
    ctx.stroke();
  }
  for (let gy = 0; gy <= height; gy += 40) {
    ctx.beginPath();
    ctx.moveTo(0, gy);
    ctx.lineTo(width, gy);
    ctx.stroke();
  }

  for (const [binId, loc] of Object.entries(binLocations)) {
    const { x, y } = project(loc.lat, loc.lon, width, height);
    ctx.fillStyle = "#6b7280";
    ctx.beginPath();
    ctx.arc(x, y, 6, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = "#1a1d29";
    ctx.font = "12px 'Inter', system-ui, sans-serif";
    ctx.fillText(binId, x + 10, y + 4);
  }

  if (truckPosition) {
    const { x, y } = project(truckPosition.lat, truckPosition.lon, width, height);
    ctx.fillStyle = "#c07a2b";
    ctx.beginPath();
    ctx.arc(x, y, 8, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = "#ffffff";
    ctx.lineWidth = 2;
    ctx.stroke();
    ctx.fillStyle = "#1a1d29";
    ctx.font = "12px 'Inter', system-ui, sans-serif";
    ctx.fillText(truckPosition.truckId ?? "truck", x + 12, y + 4);
  }
}

export function renderFleetReadouts(root, fleetReadout) {
  const hopperEl = root.querySelector('[data-testid="truck-hopper-fill"]');
  const fuelEl = root.querySelector('[data-testid="truck-fuel-level"]');
  const tonnageEl = root.querySelector('[data-testid="depot-weighbridge-tonnage"]');

  hopperEl.textContent = formatPct(fleetReadout.hopperFillPct);
  fuelEl.textContent = formatPct(fleetReadout.fuelLevelPct);
  tonnageEl.textContent = formatTonnage(fleetReadout.weighbridgeTonnage);
}

function formatPct(value) {
  return typeof value === "number" ? `${value.toFixed(1)}%` : "no data";
}

function formatTonnage(value) {
  return typeof value === "number" ? `${value.toFixed(2)} t` : "no data";
}
