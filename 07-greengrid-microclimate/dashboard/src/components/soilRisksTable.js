const RISK_LABELS = {
  irrigation_need: 'Irrigation Need',
  frost_risk: 'Frost Risk',
  disease_risk: 'Disease Risk',
};

// Soil events carry a risk classification, not the raw readings that drove it (SoilFog
// evaluates a full station snapshot per risk, so no single metric maps 1:1 to an event) -
// naming the driving sensor(s) here is what surfaces leaf-wetness anywhere in the dashboard,
// since it otherwise only ever feeds frost/disease classification silently.
const RISK_SOURCES = {
  irrigation_need: 'soil moisture, rainfall',
  frost_risk: 'air temperature, leaf wetness',
  disease_risk: 'leaf wetness, air temperature',
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
        <td class="text-secondary small">${RISK_SOURCES[event.risk] ?? '—'}</td>
        <td>${event.timestamp}</td>
      </tr>
    `)
    .join('');
}
