// Renders the fertigation table: one row per zone+metric(ec/ph/water-temperature) pair from the latest fertigation_event per pair.

function severityBadgeClass(severity) {
  if (severity === 'CRITICAL') return 'text-bg-danger';
  if (severity === 'WARNING') return 'text-bg-warning';
  return 'text-bg-success';
}

function doseDirectionLabel(doseDirection) {
  if (!doseDirection) return '—';
  return doseDirection.replace(/_/g, ' ');
}

function compensationLabel(row) {
  if (!row.temperatureCompensationNeeded) return '—';
  return '<span class="badge text-bg-info">temp. compensation</span>';
}

function renderRow(row) {
  return `
    <tr>
      <td>${row.zoneId}</td>
      <td class="text-uppercase">${row.metric}</td>
      <td>${row.value}</td>
      <td><span class="badge ${severityBadgeClass(row.severity)}">${row.severity}</span></td>
      <td>${doseDirectionLabel(row.doseDirection)}</td>
      <td>${row.lowMoisture ? '<span class="badge text-bg-info">low moisture</span>' : '—'}</td>
      <td>${compensationLabel(row)}</td>
    </tr>
  `;
}

export function renderFertigationTable(container, fertigationRows) {
  if (!fertigationRows || fertigationRows.length === 0) {
    container.innerHTML = `<p class="text-muted mb-0 py-3 text-center">No fertigation readings yet.</p>`;
    return;
  }

  container.innerHTML = `
    <table class="table table-striped table-hover align-middle mb-0">
      <thead>
        <tr>
          <th scope="col">Zone</th>
          <th scope="col">Metric</th>
          <th scope="col">Value</th>
          <th scope="col">Severity</th>
          <th scope="col">Dose direction</th>
          <th scope="col">Moisture</th>
          <th scope="col">EC compensation</th>
        </tr>
      </thead>
      <tbody>
        ${fertigationRows.map(renderRow).join('')}
      </tbody>
    </table>
  `;
}
