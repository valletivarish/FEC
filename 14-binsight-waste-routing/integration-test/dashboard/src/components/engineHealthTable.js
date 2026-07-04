function buildRow(entry) {
  const tr = document.createElement('tr');

  const degraded = Boolean(entry.degradedBearing);
  const badgeClass = degraded ? 'text-bg-danger' : 'text-bg-success';
  const badgeText = degraded ? 'DEGRADED' : 'NOMINAL';

  tr.innerHTML = `
    <td class="font-monospace">${entry.vesselId}</td>
    <td class="font-monospace">${formatNumber(entry.engineRpm)}</td>
    <td class="font-monospace">${formatNumber(entry.coolantTempC)}</td>
    <td class="font-monospace">${formatNumber(entry.oilPressureKpa)}</td>
    <td class="font-monospace">${formatNumber(entry.fuelFlowLph)}</td>
    <td class="font-monospace">${formatNumber(entry.bearingWearEnergy, 3)}</td>
    <td><span class="badge rounded-pill ${badgeClass}">${badgeText}</span></td>
  `;
  return tr;
}

function formatNumber(value, digits = 1) {
  if (value === null || value === undefined || Number.isNaN(value)) return '—';
  return Number(value).toFixed(digits);
}

export function renderEngineHealthTable(tbody, engineEvents) {
  tbody.innerHTML = '';
  // one row per vessel, most recent engine_health_event only
  const latestByVessel = new Map();
  engineEvents.forEach((event) => {
    const existing = latestByVessel.get(event.vesselId);
    if (!existing || event.timestamp > existing.timestamp) {
      latestByVessel.set(event.vesselId, event);
    }
  });

  if (latestByVessel.size === 0) {
    const tr = document.createElement('tr');
    tr.innerHTML = '<td colspan="7" class="text-center text-body-secondary">No engine health data available.</td>';
    tbody.appendChild(tr);
    return;
  }

  Array.from(latestByVessel.values())
    .sort((a, b) => a.vesselId.localeCompare(b.vesselId))
    .forEach((entry) => tbody.appendChild(buildRow(entry)));
}
