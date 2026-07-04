const RISK_LABELS = {
  irrigation_need: 'Irrigation Need',
  frost_risk: 'Frost Risk',
  disease_risk: 'Disease Risk',
};

function riskBadge(risk, severity) {
  if (risk === 'frost_risk') {
    return severity === 'warning'
      ? '<span class="badge rounded-pill text-bg-danger">frost warning</span>'
      : '<span class="badge rounded-pill text-bg-warning">frost watch</span>';
  }
  if (risk === 'disease_risk') {
    return '<span class="badge rounded-pill text-bg-danger">disease risk</span>';
  }
  return '<span class="badge rounded-pill text-bg-warning">irrigation need</span>';
}

export function renderSoilRisksTable(tbody, events) {
  const soilEvents = events.filter((event) => event.type === 'soil_event');

  if (soilEvents.length === 0) {
    tbody.innerHTML = '';
    return;
  }

  tbody.innerHTML = soilEvents
    .map((event) => `
      <tr>
        <th scope="row">${event.station_id}</th>
        <td>${riskBadge(event.risk, event.severity)} ${RISK_LABELS[event.risk] ?? event.risk}</td>
        <td>${event.severity ?? '—'}</td>
        <td>${event.timestamp}</td>
      </tr>
    `)
    .join('');
}
