function verdictBadgeClass(verdict) {
  if (verdict === 'VENTILATION_ANOMALY') return 'text-bg-danger';
  if (verdict === 'PRESSURE_FAULT') return 'text-bg-danger';
  return 'text-bg-secondary';
}

function severityBadgeClass(severity) {
  if (severity === 'critical') return 'text-bg-danger';
  if (severity === 'elevated') return 'text-bg-warning';
  return 'text-bg-secondary';
}

// PRESSURE_FAULT has no severity and no CO2 slope — show the pressure reading instead.
// Falls back to em-dash rather than rendering "undefined" for a malformed/incomplete event.
function metricCell(event) {
  if (event.verdict === 'PRESSURE_FAULT') {
    return event.pressureDifferential != null ? `${event.pressureDifferential} Pa` : '—';
  }
  return event.co2Slope != null ? `${event.co2Slope} ppm/sample` : '—';
}

export function renderComfortEventsTable(tbodyEl, events) {
  if (!events || events.length === 0) {
    tbodyEl.innerHTML = '';
    return;
  }

  tbodyEl.innerHTML = events
    .map((event) => {
      const severity = event.severity;
      const severityBadge = severity
        ? `<span class="badge rounded-pill ${severityBadgeClass(severity)}">${severity}</span>`
        : `<span class="badge rounded-pill text-bg-secondary">n/a</span>`;
      const humidity = event.humidity ?? '—';
      const windowState = event.windowState === 1 ? 'open' : event.windowState === 0 ? 'closed' : '—';
      const noiseLevel = event.noiseLevel ?? '—';
      return `
        <tr data-zone-id="${event.zoneId}">
          <td>${event.zoneId}</td>
          <td><span class="badge rounded-pill ${verdictBadgeClass(event.verdict)}">${event.verdict}</span></td>
          <td>${severityBadge}</td>
          <td>${metricCell(event)}</td>
          <td>${humidity}</td>
          <td>${windowState}</td>
          <td>${noiseLevel}</td>
          <td>${event.timestamp}</td>
        </tr>
      `;
    })
    .join('');
}
