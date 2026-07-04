function verdictBadgeClass(verdict) {
  if (verdict === 'DEVICE_LEFT_ON_ESCALATED') return 'text-bg-danger';
  if (verdict === 'DEVICE_LEFT_ON') return 'text-bg-danger';
  return 'text-bg-secondary';
}

export function renderUsageWasteTable(tbodyEl, events) {
  if (!events || events.length === 0) {
    tbodyEl.innerHTML = '';
    return;
  }

  tbodyEl.innerHTML = events
    .map((event) => `
      <tr data-zone-id="${event.zoneId}">
        <td>${event.zoneId}</td>
        <td><span class="badge rounded-pill ${verdictBadgeClass(event.verdict)}">${event.verdict}</span></td>
        <td>${event.estimatedWattHoursWasted} Wh</td>
        <td>${event.plugPower ?? '—'}</td>
        <td>${event.lightLevel ?? '—'}</td>
        <td>${event.timestamp}</td>
      </tr>
    `)
    .join('');
}
