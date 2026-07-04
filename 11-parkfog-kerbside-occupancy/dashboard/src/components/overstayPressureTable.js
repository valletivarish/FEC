// Renders overstay_event (per-bay) and zone_pressure_event (per-zone) rows side by side.
function overstayBadgeClass() {
  return 'text-bg-warning';
}

function pressureBadgeClass() {
  return 'text-bg-success';
}

export function renderOverstayPressureTable(tbodyEl, events) {
  tbodyEl.innerHTML = '';

  if (!events || events.length === 0) {
    return;
  }

  for (const event of events) {
    const row = document.createElement('tr');

    if (event.type === 'overstay_event') {
      row.innerHTML = `
        <td>${event.bayId}</td>
        <td>overstay</td>
        <td>${event.purchasedMinutesRemaining} min remaining, ANPR ${event.anprConfidence}%</td>
        <td><span class="badge rounded-pill ${overstayBadgeClass()}">overstay</span></td>
        <td>${event.timestamp}</td>
      `;
    } else if (event.type === 'zone_pressure_event') {
      row.innerHTML = `
        <td>${event.zoneId}</td>
        <td>entry pressure</td>
        <td>EWMA ${Number(event.entryPressureEwma).toFixed(2)}</td>
        <td><span class="badge rounded-pill ${pressureBadgeClass()}">nominal</span></td>
        <td>${event.timestamp}</td>
      `;
    } else {
      continue;
    }

    tbodyEl.appendChild(row);
  }
}
