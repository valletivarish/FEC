function exceedanceBadge(count) {
  // Exceedance events only dispatch once count crosses >=5 of the last 10 samples.
  return count >= 5
    ? '<span class="badge rounded-pill text-bg-danger">exceedance watch</span>'
    : '<span class="badge rounded-pill text-bg-success">within range</span>';
}

export function renderPollutionWatchTable(tbody, events) {
  const pollutionEvents = events.filter((event) => event.type === 'pollution_event');

  if (pollutionEvents.length === 0) {
    tbody.innerHTML = '';
    return;
  }

  tbody.innerHTML = pollutionEvents
    .map((event) => `
      <tr>
        <th scope="row">${event.station_id}</th>
        <td>${event.metric}</td>
        <td>${event.rolling_p95.toFixed(1)}</td>
        <td>${event.exceedance_count} ${exceedanceBadge(event.exceedance_count)}</td>
        <td>${event.timestamp}</td>
      </tr>
    `)
    .join('');
}
