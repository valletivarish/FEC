// Derives a per-station snapshot from the raw event stream — the backend exposes
// only derived weather/soil/pollution events, not a raw "latest reading" endpoint,
// so the overview folds the event log itself to find the most recent values.
const NO_DATA_BADGE = '<span class="badge rounded-pill text-bg-secondary">no data</span>';

// Station ids arrive as slugs (e.g. "station-north-lawn") — the field-report
// card header reads better as a title.
function stationLabel(stationId) {
  return stationId
    .replace(/^station-/, '')
    .split('-')
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ');
}

function formatMetric(value, digits, unit = '') {
  return typeof value === 'number' ? `${value.toFixed(digits)}${unit}` : NO_DATA_BADGE;
}

function statusBadge(stormRiskScore) {
  if (typeof stormRiskScore !== 'number') {
    return '<span class="badge rounded-pill text-bg-secondary">unknown</span>';
  }
  if (stormRiskScore >= 70) {
    return '<span class="badge rounded-pill text-bg-danger">storm watch</span>';
  }
  if (stormRiskScore >= 40) {
    return '<span class="badge rounded-pill text-bg-warning">watch</span>';
  }
  return '<span class="badge rounded-pill text-bg-success">nominal</span>';
}

export function buildStationSnapshots(events, stationIds) {
  const snapshots = new Map(stationIds.map((id) => [id, { stationId: id }]));

  // Events arrive newest-first from the event log builder, so the first hit per
  // station for a given field is already the latest known value.
  for (const event of events) {
    const snapshot = snapshots.get(event.station_id);
    if (!snapshot) continue;

    if (event.type === 'weather_event') {
      if (snapshot.windSpeed === undefined) snapshot.windSpeed = event.mean_wind_speed;
      if (snapshot.windDirection === undefined) snapshot.windDirection = event.mean_wind_direction;
      if (snapshot.barometricSlope === undefined) snapshot.barometricSlope = event.barometric_slope;
      if (snapshot.stormRiskScore === undefined) snapshot.stormRiskScore = event.storm_risk_score;
    }

    if (event.type === 'soil_event' && event.risk === 'frost_risk') {
      // Frost risk implies a recent air-temperature reading near freezing —
      // the closest signal to "latest air temperature" this event set carries.
      if (snapshot.airTemperatureHint === undefined) {
        snapshot.airTemperatureHint = event.severity === 'warning' ? '< 0' : '0 – 2';
      }
    }
  }

  return stationIds.map((id) => snapshots.get(id));
}

function fieldReportCard(snapshot) {
  const airTemp = snapshot.airTemperatureHint
    ? `${snapshot.airTemperatureHint}&deg;C`
    : NO_DATA_BADGE;

  return `
    <div class="col">
      <div class="card h-100 station-field-report" data-station-id="${snapshot.stationId}">
        <div class="card-header d-flex justify-content-between align-items-center">
          <span class="fw-semibold">${stationLabel(snapshot.stationId)}</span>
          ${statusBadge(snapshot.stormRiskScore)}
        </div>
        <ul class="list-group list-group-flush">
          <li class="list-group-item d-flex justify-content-between align-items-center">
            <span class="text-secondary">Air Temp</span>
            <span>${airTemp}</span>
          </li>
          <li class="list-group-item d-flex justify-content-between align-items-center">
            <span class="text-secondary">Wind</span>
            <span>${formatMetric(snapshot.windSpeed, 1, ' m/s')}${
              typeof snapshot.windDirection === 'number' ? ` @ ${formatMetric(snapshot.windDirection, 0, '°')}` : ''
            }</span>
          </li>
          <li class="list-group-item d-flex justify-content-between align-items-center">
            <span class="text-secondary">Pressure Trend</span>
            <span>${formatMetric(snapshot.barometricSlope, 2, ' hPa/sample')}</span>
          </li>
        </ul>
      </div>
    </div>
  `;
}

export function renderStationOverviewGrid(container, events, stationIds) {
  const snapshots = buildStationSnapshots(events, stationIds);
  container.innerHTML = snapshots.map(fieldReportCard).join('');
}
