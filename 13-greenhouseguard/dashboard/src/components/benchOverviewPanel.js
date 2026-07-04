// Renders the 3 horizontal bench-row cards, one per zone, with the actual-vs-setpoint vent gauge
// and a commanded/actual switch-pair cross-check (EnclosureFogNode's own agree/disagree signal).

function enclosureBadgeClass(faultState) {
  if (faultState === 'VENT_STALL') return 'text-bg-warning';
  if (faultState === 'VENT_OVERSHOOT' || faultState === 'BREACH') return 'text-bg-danger';
  return 'text-bg-success';
}

function enclosureBadgeLabel(faultState) {
  if (faultState === 'BREACH') return 'DOOR BREACH';
  if (faultState === 'VENT_STALL') return 'Vent Stalled';
  if (faultState === 'VENT_OVERSHOOT') return 'Vent Overshooting';
  return faultState;
}

function deriveEnclosureDisplayState(zoneStatus) {
  // the door-contact contract never dispatches a 'breach cleared' event, so an unacknowledged
  // breach is the most recent enclosure signal until it's acknowledged or a newer fault supersedes it
  const enclosureEvents = zoneStatus.faults
    .filter((f) => f.type === 'enclosure_fault_event' || f.type === 'enclosure_breach_event')
    .sort((a, b) => (a.timestamp < b.timestamp ? 1 : -1));

  const latest = enclosureEvents[0];
  if (!latest) return 'ENCLOSURE_OK';
  if (latest.type === 'enclosure_breach_event') return latest.acknowledged ? 'ENCLOSURE_OK' : 'BREACH';
  return latest.faultState;
}

function renderVentCrossCheck(enclosureState, setpoint, actual) {
  // BREACH means the door contact fired, not a commanded/actual vent mismatch — cross-check stays neutral
  const isFault = enclosureState === 'VENT_STALL' || enclosureState === 'VENT_OVERSHOOT';
  const commandedLabel = setpoint != null && setpoint >= 50 ? 'Open' : 'Closed';
  const actualLabel = actual >= 50 ? 'Open' : 'Closed';
  const chipClass = isFault ? 'gg-match-chip gg-fault-chip' : 'gg-match-chip';
  const chipIcon = isFault ? 'bi-exclamation-octagon' : 'bi-check-circle';
  const chipLabel = isFault ? 'FAULT' : 'MATCH';

  return `
    <div class="bench-vent-checks mt-3">
      <div class="gg-vent-check">
        <span class="gg-vent-check-label">Commanded</span>
        <span class="gg-vent-state">${commandedLabel}</span>
      </div>
      <div class="gg-vent-check">
        <span class="gg-vent-check-label">Actual</span>
        <span class="gg-vent-state">${actualLabel}</span>
      </div>
      <span class="${chipClass} bench-cross-check-chip">
        <i class="bi ${chipIcon}" aria-hidden="true"></i>
        ${chipLabel}
      </span>
    </div>
  `;
}

function renderBenchRow(zoneStatus) {
  const { zoneId, latestCommand, ventActual, vpdKpa } = zoneStatus;
  const setpoint = latestCommand ? latestCommand.ventPositionSetpoint : null;
  const actual = ventActual != null ? ventActual : 0;
  const setpointDisplay = setpoint != null ? setpoint : 0;
  const enclosureState = deriveEnclosureDisplayState(zoneStatus);

  const vpdText = vpdKpa != null ? `${vpdKpa.toFixed(2)} kPa` : 'no reading yet';
  const readoutText =
    setpoint != null
      ? `${actual}% actual / ${setpoint}% setpoint`
      : `${actual}% actual / setpoint unknown`;

  return `
    <div class="card bench-row-card mb-3">
      <div class="card-body">
        <div class="d-flex justify-content-between align-items-start flex-wrap gap-2">
          <div>
            <h3 class="h5 mb-1">${zoneId}</h3>
            <p class="text-muted mb-0 small"><span title="Vapor Pressure Deficit -- how much drying power the air has; too low risks fungal disease, too high stresses plants">VPD</span>: <span class="bench-vpd-value">${vpdText}</span></p>
          </div>
          <span class="badge ${enclosureBadgeClass(enclosureState)} bench-state-pill">${enclosureBadgeLabel(enclosureState)}</span>
        </div>
        <div class="mt-3">
          <div class="progress bench-progress" role="progressbar" aria-label="Vent position actual vs setpoint"
               aria-valuenow="${actual}" aria-valuemin="0" aria-valuemax="100">
            <div class="progress-bar bench-progress-bar" style="width: ${actual}%"></div>
            ${
              setpoint != null
                ? `<div class="bench-setpoint-marker" style="left: ${setpointDisplay}%" title="Setpoint ${setpointDisplay}%"></div>`
                : ''
            }
          </div>
          <p class="small text-muted mt-1 mb-0">${readoutText}</p>
        </div>
        ${renderVentCrossCheck(enclosureState, setpoint, actual)}
      </div>
    </div>
  `;
}

export function renderBenchOverviewPanel(container, zoneStatuses) {
  if (!zoneStatuses || zoneStatuses.length === 0) {
    container.innerHTML = `
      <div class="bench-empty-state text-center py-5">
        <p class="mb-1 fw-semibold">No live bench data yet</p>
        <p class="text-muted mb-0">Waiting for a backend connection to report zone status for zone-a, zone-b and zone-c.</p>
      </div>
    `;
    return;
  }

  container.innerHTML = zoneStatuses.map(renderBenchRow).join('');
}
