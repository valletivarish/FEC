const CLASS_BADGE = {
  CALM: 'text-bg-success',
  LIGHT: 'text-bg-info',
  MODERATE: 'text-bg-warning',
  ROUGH: 'text-bg-danger',
  SEVERE: 'text-bg-dark',
};

function formatNumber(value, digits = 1) {
  if (value === null || value === undefined || Number.isNaN(value)) return '—';
  return Number(value).toFixed(digits);
}

function buildRow(entry) {
  const tr = document.createElement('tr');
  const badgeClass = CLASS_BADGE[entry.seaStateClass] || 'text-bg-secondary';

  tr.innerHTML = `
    <td class="font-monospace">${entry.vesselId}</td>
    <td><span class="badge rounded-pill ${badgeClass}">${entry.seaStateClass || 'UNKNOWN'}</span></td>
    <td class="font-monospace">${formatNumber(entry.rollAmplitudeDeg)}</td>
    <td class="font-monospace">${formatNumber(entry.rollPeriodEstimate)}</td>
    <td class="font-monospace">${formatNumber(entry.meanWindSpeedKn)}</td>
  `;
  return tr;
}

export function renderSeaStateTable(tbody, seaStateEvents) {
  tbody.innerHTML = '';
  const latestByVessel = new Map();
  seaStateEvents.forEach((event) => {
    const existing = latestByVessel.get(event.vesselId);
    if (!existing || event.timestamp > existing.timestamp) {
      latestByVessel.set(event.vesselId, event);
    }
  });

  if (latestByVessel.size === 0) {
    const tr = document.createElement('tr');
    tr.innerHTML = '<td colspan="5" class="text-center text-body-secondary">No sea state data available.</td>';
    tbody.appendChild(tr);
    return;
  }

  Array.from(latestByVessel.values())
    .sort((a, b) => a.vesselId.localeCompare(b.vesselId))
    .forEach((entry) => tbody.appendChild(buildRow(entry)));
}
