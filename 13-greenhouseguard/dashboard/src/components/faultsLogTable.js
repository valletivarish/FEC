// Renders the chronological faults & DLI log with an Acknowledge action wired to the API client.

function eventSummary(entry) {
  if (entry.type === 'enclosure_fault_event') {
    return `${entry.faultState} — actual ${entry.ventPositionActual}% vs setpoint ${entry.ventPositionSetpoint}%`;
  }
  if (entry.type === 'enclosure_breach_event') {
    return `Door open while vent setpoint ${entry.ventPositionSetpoint}% (below 20%)`;
  }
  if (entry.type === 'fertigation_event') {
    return `${entry.metric.toUpperCase()} ${entry.severity} at ${entry.value}`;
  }
  if (entry.type === 'dli_event') {
    return `DLI shortfall: ${entry.accumulatedDli.toFixed(1)} mol/m2 so far today`;
  }
  return entry.type;
}

function typeLabel(type) {
  return type.replace(/_/g, ' ');
}

function renderRow(entry, apiClient, onAcknowledged) {
  const isDli = entry.type === 'dli_event';
  const rowId = `fault-row-${entry.zoneId}-${entry.eventTypeTimestamp || entry.timestamp}`;
  const acknowledgedClass = entry.acknowledged ? 'table-secondary text-muted' : '';

  const actionCell = isDli
    ? '—'
    : entry.acknowledged
      ? '<span class="badge text-bg-secondary">Acknowledged</span>'
      : `<button type="button" class="btn btn-sm btn-outline-secondary btn-acknowledge">Acknowledge</button>`;

  const row = document.createElement('tr');
  row.id = rowId;
  row.className = acknowledgedClass;
  row.innerHTML = `
    <td>${entry.timestamp}</td>
    <td>${entry.zoneId}</td>
    <td>${typeLabel(entry.type)}</td>
    <td>${eventSummary(entry)}</td>
    <td class="text-end">${actionCell}</td>
  `;

  if (!isDli && !entry.acknowledged) {
    const button = row.querySelector('.btn-acknowledge');
    button.addEventListener('click', async () => {
      button.disabled = true;
      button.textContent = 'Acknowledging…';
      const success = await apiClient.acknowledgeFault(entry.zoneId, entry.eventTypeTimestamp).then(
        () => true,
        () => false
      );
      if (success) {
        row.className = 'table-secondary text-muted';
        const actionTd = row.children[4];
        actionTd.innerHTML = '<span class="badge text-bg-secondary">Acknowledged</span>';
        if (onAcknowledged) onAcknowledged(entry);
      } else {
        button.disabled = false;
        button.textContent = 'Acknowledge';
      }
    });
  }

  return row;
}

export function renderFaultsLogTable(container, logEntries, apiClient, onAcknowledged) {
  if (!logEntries || logEntries.length === 0) {
    container.innerHTML = `<p class="text-muted mb-0 py-3 text-center">No faults or DLI events logged yet.</p>`;
    return;
  }

  const sorted = [...logEntries].sort((a, b) => (a.timestamp < b.timestamp ? 1 : -1));

  const table = document.createElement('table');
  table.className = 'table table-striped table-hover align-middle mb-0';
  table.innerHTML = `
    <thead>
      <tr>
        <th scope="col">Timestamp</th>
        <th scope="col">Zone</th>
        <th scope="col">Type</th>
        <th scope="col">Detail</th>
        <th scope="col" class="text-end">Action</th>
      </tr>
    </thead>
    <tbody></tbody>
  `;

  const tbody = table.querySelector('tbody');
  sorted.forEach((entry) => {
    tbody.appendChild(renderRow(entry, apiClient, onAcknowledged));
  });

  container.innerHTML = '';
  container.appendChild(table);
}
