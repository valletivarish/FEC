// Summary KPI row for the overview: every figure is aggregated from the real zone-status
// event stream, never fabricated. When no events are present the cards read 0.
const BAY_IDS = ['bay-01', 'bay-02', 'bay-03', 'bay-04', 'bay-05', 'bay-06'];
const RAISED_FLOOD_BANDS = new Set(['caution', 'restricted', 'closed']);

function computeKpis(events) {
  const latestByBay = new Map();
  for (const event of events) {
    if (event.type === 'bay_state_event') latestByBay.set(event.bayId, event);
  }

  let occupied = 0;
  let available = 0;
  let violations = 0;
  for (const bayId of BAY_IDS) {
    const event = latestByBay.get(bayId);
    if (!event) continue;
    if (event.state === 'OCCUPIED') occupied += 1;
    if (event.state === 'UNOCCUPIED') available += 1;
    if (event.disabledBayViolation) violations += 1;
  }

  const overstays = events.filter((e) => e.type === 'overstay_event').length;
  const evFaults = events.filter((e) => e.type === 'ev_fault_event').length;
  const floodAlerts = events.filter(
    (e) => e.type === 'flood_risk_event' && RAISED_FLOOD_BANDS.has(e.band)
  ).length;
  const activeAlerts = overstays + evFaults + floodAlerts + violations;

  return { occupied, available, activeAlerts, eventCount: events.length };
}

export function renderKpiRow(container) {
  container.innerHTML = `
    <div class="kpi-row" aria-label="Kerbside summary">
      <div class="kpi-card">
        <span class="kpi-icon kpi-icon-plum"><i class="bi bi-car-front"></i></span>
        <div class="kpi-value" data-kpi="occupied">0</div>
        <div class="kpi-label">Bays Occupied</div>
      </div>
      <div class="kpi-card">
        <span class="kpi-icon kpi-icon-green"><i class="bi bi-p-square"></i></span>
        <div class="kpi-value" data-kpi="available">0</div>
        <div class="kpi-label">Bays Available</div>
      </div>
      <div class="kpi-card">
        <span class="kpi-icon kpi-icon-red"><i class="bi bi-exclamation-triangle"></i></span>
        <div class="kpi-value" data-kpi="active-alerts">0</div>
        <div class="kpi-label">Active Alerts</div>
      </div>
      <div class="kpi-card">
        <span class="kpi-icon kpi-icon-amber"><i class="bi bi-list-ul"></i></span>
        <div class="kpi-value" data-kpi="events">0</div>
        <div class="kpi-label">Events Tracked</div>
      </div>
    </div>
  `;
}

export function updateKpiRow(container, events) {
  const { occupied, available, activeAlerts, eventCount } = computeKpis(events || []);
  container.querySelector('[data-kpi="occupied"]').textContent = String(occupied);
  container.querySelector('[data-kpi="available"]').textContent = String(available);
  container.querySelector('[data-kpi="active-alerts"]').textContent = String(activeAlerts);
  container.querySelector('[data-kpi="events"]').textContent = String(eventCount);
}
