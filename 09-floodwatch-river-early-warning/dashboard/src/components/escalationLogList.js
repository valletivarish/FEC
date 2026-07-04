// Every event shape (hydro/quality/meteo) is normalized into one row here so the log
// reads as a single chronological narrative rather than three disjoint feeds.
const SEVERITY_ACCENT = {
  GREEN: "severity-accent-success",
  GOOD: "severity-accent-success",
  AMBER: "severity-accent-warning",
  FAIR: "severity-accent-warning",
  RED: "severity-accent-danger",
  POOR: "severity-accent-danger",
  CONTAMINATION: "severity-accent-danger",
  ESCALATION: "severity-accent-danger",
};

const STATUS_BADGE = {
  GREEN: "text-bg-success",
  GOOD: "text-bg-success",
  AMBER: "text-bg-warning",
  FAIR: "text-bg-warning",
  RED: "text-bg-danger",
  POOR: "text-bg-danger",
  CONTAMINATION: "text-bg-danger",
  ESCALATION: "text-bg-danger",
};

function accentClassForStatus(status) {
  return SEVERITY_ACCENT[status] || "severity-accent-secondary";
}

function badgeClassForStatus(status) {
  return STATUS_BADGE[status] || "text-bg-secondary";
}

function describeEvent(event) {
  if (event.type === "hydro_event") {
    return { detail: `River level ${event.riverLevel}m, rate of rise ${event.rateOfRise}`, status: event.stage };
  }
  if (event.type === "quality_event") {
    if (event.contaminationSuspected) {
      return { detail: `Turbidity ${event.turbidity} NTU, DO ${event.dissolvedOxygen} mg/L`, status: "CONTAMINATION" };
    }
    return { detail: `CWQI ${event.cwqi}`, status: event.band };
  }
  if (event.type === "meteo_event") {
    if (event.preWarnEscalation) {
      return { detail: `Pressure slope ${event.pressureSlope} hPa/sample`, status: "ESCALATION" };
    }
    return { detail: `Pressure slope ${event.pressureSlope} hPa/sample`, status: event.preStormSignal ? "AMBER" : "GREEN" };
  }
  return { detail: "", status: "UNKNOWN" };
}

export function renderEscalationLogList(listEl, events) {
  listEl.innerHTML = "";

  if (!events || events.length === 0) {
    listEl.innerHTML = `<div class="list-group-item text-center text-muted" id="escalationLogEmpty">No escalation events recorded</div>`;
    return;
  }

  const sorted = [...events].sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));

  for (const event of sorted) {
    const { detail, status } = describeEvent(event);
    const item = document.createElement("div");
    item.className = `list-group-item escalation-log-item ${accentClassForStatus(status)}`;
    item.innerHTML = `
      <div class="d-flex w-100 justify-content-between align-items-start gap-2">
        <div>
          <div class="d-flex align-items-center gap-2 mb-1">
            <span class="fw-semibold reach-id">${event.reachId}</span>
            <span class="badge rounded-pill ${badgeClassForStatus(status)}">${status}</span>
            <span class="text-muted text-uppercase small">${event.type}</span>
          </div>
          <div class="small text-body-secondary">${detail}</div>
        </div>
        <small class="text-muted text-nowrap">${event.timestamp}</small>
      </div>
    `;
    listEl.appendChild(item);
  }
}
