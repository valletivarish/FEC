// Summary cards over the whole office: static domain counts (sensor types, fog nodes, zones)
// plus live aggregates (fault events, running workers) recomputed from each fetched zone status.
const SENSOR_TYPE_COUNT = 10;
const FOG_NODE_COUNT = 3;

export function renderKpiRow(container, zoneCount) {
  container.innerHTML = `
    <div class="kpi-row" aria-label="Office summary">
      <div class="kpi-card">
        <span class="kpi-icon kpi-icon-indigo"><i class="bi bi-building"></i></span>
        <div>
          <div class="kpi-value" data-kpi="zones">${zoneCount}</div>
          <div class="kpi-label">Zones Monitored</div>
        </div>
      </div>
      <div class="kpi-card">
        <span class="kpi-icon kpi-icon-blue"><i class="bi bi-thermometer-half"></i></span>
        <div>
          <div class="kpi-value" data-kpi="sensor-types">${SENSOR_TYPE_COUNT}</div>
          <div class="kpi-label">Sensor Types</div>
        </div>
      </div>
      <div class="kpi-card">
        <span class="kpi-icon kpi-icon-green"><i class="bi bi-diagram-3"></i></span>
        <div>
          <div class="kpi-value" data-kpi="fog-nodes">${FOG_NODE_COUNT}</div>
          <div class="kpi-label">Fog Nodes</div>
        </div>
      </div>
      <div class="kpi-card">
        <span class="kpi-icon kpi-icon-red"><i class="bi bi-exclamation-triangle"></i></span>
        <div>
          <div class="kpi-value" data-kpi="active-alerts">0</div>
          <div class="kpi-label">Active Alerts</div>
        </div>
      </div>
      <div class="kpi-card">
        <span class="kpi-icon kpi-icon-amber"><i class="bi bi-cpu"></i></span>
        <div>
          <div class="kpi-value" data-kpi="running-workers">0</div>
          <div class="kpi-label">Workers Running</div>
          <div class="kpi-gauge-track d-none" data-kpi-gauge="running-workers">
            <div class="kpi-gauge-fill" data-kpi-gauge-fill="running-workers"></div>
          </div>
        </div>
      </div>
    </div>
  `;
}

// Active alerts = every fog-emitted event across the office (occupancy + comfort + usage).
// Workers running = the real ECS Fargate running task count, gauged against the desired
// count so the bar reflects an actual fleet-capacity ratio, not a fabricated percentage.
export function updateKpiRow(container, data) {
  const activeAlerts =
    (data.occupancyEvents?.length || 0) +
    (data.comfortEvents?.length || 0) +
    (data.usageEvents?.length || 0);
  const runningWorkers = data.scalingStatus?.runningCount ?? 0;
  const desiredWorkers = data.scalingStatus?.desiredCount ?? 0;

  container.querySelector('[data-kpi="active-alerts"]').textContent = String(activeAlerts);
  container.querySelector('[data-kpi="running-workers"]').textContent = String(runningWorkers);

  const gaugeTrack = container.querySelector('[data-kpi-gauge="running-workers"]');
  const gaugeFill = container.querySelector('[data-kpi-gauge-fill="running-workers"]');
  if (desiredWorkers > 0) {
    const ratio = Math.min(runningWorkers / desiredWorkers, 1);
    gaugeFill.style.width = `${ratio * 100}%`;
    gaugeTrack.classList.remove('d-none');
  } else {
    gaugeTrack.classList.add('d-none');
  }
}
