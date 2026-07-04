function riskBadge(score) {
  if (score >= 70) return '<span class="badge rounded-pill text-bg-danger">storm watch</span>';
  if (score >= 40) return '<span class="badge rounded-pill text-bg-warning">elevated</span>';
  return '<span class="badge rounded-pill text-bg-success">nominal</span>';
}

export function findMostRecentWeatherEvent(events) {
  // Event log is newest-first, so the first weather_event encountered is the latest.
  return events.find((event) => event.type === 'weather_event') ?? null;
}

export function renderWeatherWatchCard(container, events) {
  const event = findMostRecentWeatherEvent(events);

  if (!event) {
    container.innerHTML = `
      <div class="card">
        <div class="card-body">
          <p class="card-text text-secondary mb-0">No weather watch events reported yet.</p>
        </div>
      </div>
    `;
    return;
  }

  container.innerHTML = `
    <div class="card">
      <div class="card-body">
        <h3 class="card-title h5">${event.station_id} ${riskBadge(event.storm_risk_score)}</h3>
        <p class="card-subtitle mb-3 text-secondary">Storm risk score: ${event.storm_risk_score.toFixed(1)} / 100</p>
        <ul class="list-group list-group-flush mt-3">
          <li class="list-group-item">Mean wind speed: ${event.mean_wind_speed.toFixed(1)} m/s</li>
          <li class="list-group-item">Mean wind direction: ${event.mean_wind_direction.toFixed(0)}&deg;</li>
          <li class="list-group-item">Barometric slope: ${event.barometric_slope.toFixed(2)} hPa/sample</li>
          <li class="list-group-item">UV index: ${event.uv_index.toFixed(1)}</li>
          <li class="list-group-item">Reported: ${event.timestamp}</li>
        </ul>
      </div>
    </div>
  `;
}
