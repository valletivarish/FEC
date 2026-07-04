function verdictBadgeClass(verdict) {
  if (verdict === 'SENSOR_DRIFT') return 'text-bg-danger';
  if (verdict === 'STANDING_ROOM') return 'text-bg-warning';
  return 'text-bg-secondary';
}

export function renderOccupancyReconciliationTable(tbodyEl, events) {
  if (!events || events.length === 0) {
    tbodyEl.innerHTML = '';
    return;
  }

  tbodyEl.innerHTML = events
    .map((event) => `
      <tr data-zone-id="${event.zoneId}">
        <td>${event.zoneId}</td>
        <td><span class="badge rounded-pill ${verdictBadgeClass(event.verdict)}">${event.verdict}</span></td>
        <td>${event.deskOccupiedCount}</td>
        <td>${event.netPeopleCount}</td>
        <td>${event.resolvedHeadcount}</td>
        <td>${event.timestamp}</td>
      </tr>
    `)
    .join('');
}
