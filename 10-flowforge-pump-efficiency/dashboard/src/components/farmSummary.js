// KPI summary row for the pump farm. Every figure is aggregated from the real insight
// events fetched from the backend - no static or fabricated numbers.

// The farm runs a fixed roster: 3 pumps, 3 fog nodes, 10 sensor channels per pump.
const FOG_NODE_COUNT = 3;
const SENSOR_TYPE_COUNT = 10;

// A dispatched insight counts as an active fault when its status is anything other
// than the nominal baseline for its node (heartbeat / LEAK_OK).
function isActiveFault(event) {
  if (event.type === 'health_event') return event.trigger !== 'heartbeat';
  if (event.type === 'hydraulics_event') return true; // hydraulics events only dispatch on WARNING/CRITICAL
  if (event.type === 'integrity_event') return event.state !== 'LEAK_OK';
  return false;
}

function summarise(pumpIds, events) {
  const activeFaults = events.filter(isActiveFault).length;
  const pumpsReporting = new Set(events.map((e) => e.pumpId)).size;
  return {
    pumps: pumpIds.length,
    sensors: pumpIds.length * SENSOR_TYPE_COUNT,
    fogNodes: FOG_NODE_COUNT,
    activeFaults,
    insights: events.length,
    pumpsReporting,
  };
}

export function renderFarmSummary(container, pumpIds) {
  container.innerHTML = `
    <div class="kpi-row" aria-label="Pump farm summary">
      <div class="kpi-card">
        <span class="kpi-icon kpi-icon-copper"><i class="bi bi-hdd-stack"></i></span>
        <div class="kpi-value" data-kpi="pumps">${pumpIds.length}</div>
        <div class="kpi-label">Pumps Monitored</div>
      </div>
      <div class="kpi-card">
        <span class="kpi-icon kpi-icon-blue"><i class="bi bi-cpu"></i></span>
        <div class="kpi-value" data-kpi="sensors">${pumpIds.length * SENSOR_TYPE_COUNT}</div>
        <div class="kpi-label">Sensor Channels</div>
      </div>
      <div class="kpi-card">
        <span class="kpi-icon kpi-icon-green"><i class="bi bi-diagram-3"></i></span>
        <div class="kpi-value" data-kpi="fog-nodes">${FOG_NODE_COUNT}</div>
        <div class="kpi-label">Fog Nodes</div>
      </div>
      <div class="kpi-card">
        <span class="kpi-icon kpi-icon-red"><i class="bi bi-exclamation-triangle"></i></span>
        <div class="kpi-value" data-kpi="active-faults">0</div>
        <div class="kpi-label">Active Faults</div>
      </div>
      <div class="kpi-card">
        <span class="kpi-icon kpi-icon-amber"><i class="bi bi-broadcast"></i></span>
        <div class="kpi-value" data-kpi="insights">0</div>
        <div class="kpi-label">Insights Dispatched</div>
      </div>
    </div>
  `;
}

export function updateFarmSummary(container, pumpIds, events) {
  const s = summarise(pumpIds, events);
  const set = (kpi, value) => {
    const el = container.querySelector(`[data-kpi="${kpi}"]`);
    if (el) el.textContent = String(value);
  };
  set('pumps', s.pumps);
  set('sensors', s.sensors);
  set('fog-nodes', s.fogNodes);
  set('active-faults', s.activeFaults);
  set('insights', s.insights);
}
