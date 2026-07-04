// Renders the resident roster as large list-group items — the primary "at a glance" panel.
const RISK_BADGE_CLASS = {
  CRITICAL: 'badge rounded-pill risk-critical',
  WARNING: 'badge rounded-pill text-bg-warning',
  NORMAL: 'badge rounded-pill text-bg-success',
};

function riskBadgeMarkup(riskState) {
  const state = riskState || 'NORMAL';
  const cls = RISK_BADGE_CLASS[state] || RISK_BADGE_CLASS.NORMAL;
  return `<span class="${cls}" data-testid="risk-pill">${state}</span>`;
}

function vitalsSummaryLine(resident) {
  const detail = resident.latestEventDetail;
  if (detail) {
    return detail;
  }
  return 'No recent vitals reported yet.';
}

export function renderResidentRosterPanel(residents) {
  if (!residents || residents.length === 0) {
    return `
      <div class="list-group shadow-sm" data-testid="resident-roster-list">
        <div class="list-group-item py-3 text-muted" data-testid="resident-roster-empty">
          No residents are currently reporting data. Once a resident's wearable connects, they will appear here.
        </div>
      </div>`;
  }

  const items = residents
    .map((resident) => {
      const name = resident.residentName || resident.residentId;
      return `
      <div class="list-group-item d-flex justify-content-between align-items-center py-3" data-testid="resident-roster-item" data-resident-id="${resident.residentId}">
        <div>
          <div class="fw-semibold mb-1">${name}</div>
          <div class="fs-6 text-muted">${vitalsSummaryLine(resident)}</div>
        </div>
        ${riskBadgeMarkup(resident.currentRiskState)}
      </div>`;
    })
    .join('');

  return `<div class="list-group shadow-sm" data-testid="resident-roster-list">${items}</div>`;
}
