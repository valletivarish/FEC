const TYPE_LABELS = {
  weather_event: 'Weather',
  soil_event: 'Soil',
  pollution_event: 'Pollution',
};

function typeBadge(type) {
  if (type === 'weather_event') return '<span class="badge rounded-pill text-bg-danger">weather</span>';
  if (type === 'soil_event') return '<span class="badge rounded-pill text-bg-warning">soil</span>';
  if (type === 'pollution_event') return '<span class="badge rounded-pill text-bg-danger">pollution</span>';
  return '<span class="badge rounded-pill text-bg-secondary">unknown</span>';
}

function detailFor(event) {
  if (event.type === 'weather_event') {
    return `storm risk score ${event.storm_risk_score.toFixed(1)}`;
  }
  if (event.type === 'soil_event') {
    return `${event.risk}${event.severity ? ` (${event.severity})` : ''}`;
  }
  if (event.type === 'pollution_event') {
    return `${event.metric} p95 ${event.rolling_p95.toFixed(1)}, exceedance ${event.exceedance_count}`;
  }
  return '—';
}

// Sorts newest-first; every other component relies on this ordering to find
// the "latest" value for a station without re-sorting itself.
export function sortEventsNewestFirst(events) {
  return [...events].sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));
}

export function renderEventLogTable(tbody, events) {
  const sorted = sortEventsNewestFirst(events);

  tbody.innerHTML = sorted
    .map((event) => `
      <tr>
        <td>${event.timestamp}</td>
        <th scope="row">${event.station_id}</th>
        <td>${typeBadge(event.type)} ${TYPE_LABELS[event.type] ?? event.type}</td>
        <td>${detailFor(event)}</td>
      </tr>
    `)
    .join('');
}
