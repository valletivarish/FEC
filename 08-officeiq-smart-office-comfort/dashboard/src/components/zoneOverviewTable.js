// Status badge reflects the worst comfort/occupancy signal currently known for the zone.
function statusBadgeClass(status) {
  if (status === 'nominal') return 'text-bg-success';
  if (status === 'elevated') return 'text-bg-warning';
  if (status === 'critical') return 'text-bg-danger';
  return 'text-bg-secondary';
}

export function renderZoneOverviewTable(tbodyEl, zones) {
  if (!zones || zones.length === 0) {
    tbodyEl.innerHTML = '';
    return;
  }

  tbodyEl.innerHTML = zones
    .map((zone) => {
      const deskOccupancy = zone.deskOccupancy ?? '—';
      const co2 = zone.roomCo2 ?? '—';
      const temperature = zone.roomTemperature ?? '—';
      const status = zone.status || 'unknown';
      return `
        <tr data-zone-id="${zone.zoneId}">
          <td>${zone.zoneId}</td>
          <td>${deskOccupancy}</td>
          <td>${co2}</td>
          <td>${temperature}</td>
          <td><span class="badge rounded-pill ${statusBadgeClass(status)}">${status}</span></td>
        </tr>
      `;
    })
    .join('');
}
