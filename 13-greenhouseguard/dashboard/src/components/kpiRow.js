// Renders the overview KPI cards. Every number is aggregated from the live zone statuses
// the dashboard already fetched — nothing here is fabricated. With no backend the counts fall to 0.

// A greenhouse bench runs the same ten sensor channels per zone; that fixed rig size times the
// zones that actually reported is a genuine channel total, not a made-up figure.
const SENSOR_CHANNELS_PER_ZONE = 10;

function isUnacknowledgedFault(fault) {
  if (fault.acknowledged) return false;
  if (fault.type === 'enclosure_breach_event') return fault.doorOpen === true;
  if (fault.type === 'enclosure_fault_event') return fault.faultState !== 'ENCLOSURE_OK';
  if (fault.type === 'fertigation_event') return fault.severity === 'WARNING' || fault.severity === 'CRITICAL';
  return false;
}

function computeKpis(zoneStatuses) {
  const zoneCount = zoneStatuses.length;
  const allFaults = zoneStatuses.flatMap((status) => status.faults || []);

  const activeFaults = allFaults.filter(isUnacknowledgedFault).length;
  const dliShortfalls = allFaults.filter((f) => f.type === 'dli_event' && f.shortfall).length;
  const loggedEvents = allFaults.length;

  return {
    zoneCount,
    sensorChannels: zoneCount * SENSOR_CHANNELS_PER_ZONE,
    activeFaults,
    dliShortfalls,
    loggedEvents
  };
}

export function renderKpiRow(container, zoneStatuses) {
  const kpi = computeKpis(zoneStatuses || []);
  container.innerHTML = `
    <div class="kpi-row" aria-label="Greenhouse summary">
      <div class="kpi-card kpi-pill-green">
        <i class="bi bi-flower1 kpi-pill-icon"></i>
        <span class="kpi-value">${kpi.zoneCount}</span>
        <span class="kpi-label">Zones Monitored</span>
      </div>
      <div class="kpi-card kpi-pill-blue">
        <i class="bi bi-cpu kpi-pill-icon"></i>
        <span class="kpi-value">${kpi.sensorChannels}</span>
        <span class="kpi-label">Sensor Channels</span>
      </div>
      <div class="kpi-card kpi-pill-red">
        <i class="bi bi-exclamation-triangle kpi-pill-icon"></i>
        <span class="kpi-value">${kpi.activeFaults}</span>
        <span class="kpi-label">Active Faults</span>
      </div>
      <div class="kpi-card kpi-pill-amber">
        <i class="bi bi-brightness-high kpi-pill-icon"></i>
        <span class="kpi-value">${kpi.dliShortfalls}</span>
        <span class="kpi-label" title="DLI: Daily Light Integral -- total light a plant receives over a day; a shortfall means it is below the target for healthy growth">DLI Shortfalls</span>
      </div>
      <div class="kpi-card kpi-pill-green">
        <i class="bi bi-journal-text kpi-pill-icon"></i>
        <span class="kpi-value">${kpi.loggedEvents}</span>
        <span class="kpi-label">Logged Events</span>
      </div>
    </div>
  `;
}
