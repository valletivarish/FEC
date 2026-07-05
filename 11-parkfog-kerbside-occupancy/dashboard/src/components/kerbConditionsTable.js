// Splits flood_risk_event (per-zone), ev_fault_event (per-bay), and camera_discrepancy_event
// (per-zone, camera vs fused-vote mismatch) into one conditions table.
function floodBandBadgeClass(band) {
  if (band === 'clear') return 'text-bg-success';
  if (band === 'caution') return 'text-bg-warning';
  if (band === 'restricted' || band === 'closed') return 'text-bg-danger';
  return 'text-bg-secondary';
}

export function renderKerbConditionsTable(tbodyEl, events) {
  tbodyEl.innerHTML = '';

  if (!events || events.length === 0) {
    return;
  }

  for (const event of events) {
    const row = document.createElement('tr');

    if (event.type === 'flood_risk_event') {
      row.innerHTML = `
        <td>${event.zoneId}</td>
        <td>flood risk</td>
        <td><span class="badge rounded-pill ${floodBandBadgeClass(event.band)}">${event.band}</span></td>
        <td>avg ${event.averageFloodLevel} mm</td>
        <td>${event.timestamp}</td>
      `;
    } else if (event.type === 'ev_fault_event') {
      row.innerHTML = `
        <td>${event.bayId}</td>
        <td>EV charger fault</td>
        <td><span class="badge rounded-pill text-bg-danger">fault</span></td>
        <td>15 consecutive fault readings</td>
        <td>${event.timestamp}</td>
      `;
    } else if (event.type === 'camera_discrepancy_event') {
      row.innerHTML = `
        <td>${event.zoneId}</td>
        <td>camera discrepancy</td>
        <td><span class="badge rounded-pill text-bg-warning">mismatch</span></td>
        <td>camera ${event.cameraFreeCount} free vs fused ${event.fusedFreeCount} free (occlusion ${event.occlusionPercent}%)</td>
        <td>${event.timestamp}</td>
      `;
    } else {
      continue;
    }

    tbodyEl.appendChild(row);
  }
}
