// KPI summary row — every value is aggregated from the same event stream the rest
// of the dashboard renders, so the cards never show a figure the tables can't back up.
// Exceedance events only dispatch once count crosses >=5 of the last 10 samples;
// storm watches once storm_risk_score crosses 70 — the same thresholds the fog layer uses.
const EXCEEDANCE_THRESHOLD = 5;
const STORM_WATCH_THRESHOLD = 70;

export function computeSummary(events, stationIds) {
  const stormWatches = events.filter(
    (event) => event.type === 'weather_event' && event.storm_risk_score >= STORM_WATCH_THRESHOLD
  ).length;
  const soilRisks = events.filter((event) => event.type === 'soil_event').length;
  const pollutionExceedances = events.filter(
    (event) => event.type === 'pollution_event' && event.exceedance_count >= EXCEEDANCE_THRESHOLD
  ).length;

  return {
    stations: stationIds.length,
    events: events.length,
    stormWatches,
    soilRisks,
    pollutionExceedances,
  };
}

export function renderSummaryKpiRow(container, events, stationIds) {
  const summary = computeSummary(events, stationIds);

  container.innerHTML = `
    <div class="kpi-row" aria-label="Network summary">
      <div class="kpi-card">
        <span class="kpi-icon kpi-icon-green"><i class="bi bi-broadcast-pin"></i></span>
        <div class="kpi-card-body">
          <div class="kpi-value" data-kpi="stations">${summary.stations}</div>
          <div class="kpi-label">Stations Monitored</div>
        </div>
      </div>
      <div class="kpi-card">
        <span class="kpi-icon kpi-icon-blue"><i class="bi bi-journal-text"></i></span>
        <div class="kpi-card-body">
          <div class="kpi-value" data-kpi="events">${summary.events}</div>
          <div class="kpi-label">Events Logged</div>
        </div>
      </div>
      <div class="kpi-card">
        <span class="kpi-icon kpi-icon-red"><i class="bi bi-cloud-lightning-rain"></i></span>
        <div class="kpi-card-body">
          <div class="kpi-value" data-kpi="storm-watches">${summary.stormWatches}</div>
          <div class="kpi-label">Storm Watches</div>
        </div>
      </div>
      <div class="kpi-card">
        <span class="kpi-icon kpi-icon-amber"><i class="bi bi-moisture"></i></span>
        <div class="kpi-card-body">
          <div class="kpi-value" data-kpi="soil-risks">${summary.soilRisks}</div>
          <div class="kpi-label">Soil Risks</div>
        </div>
      </div>
      <div class="kpi-card">
        <span class="kpi-icon kpi-icon-red"><i class="bi bi-wind"></i></span>
        <div class="kpi-card-body">
          <div class="kpi-value" data-kpi="pollution-exceedances">${summary.pollutionExceedances}</div>
          <div class="kpi-label">Pollution Exceedances</div>
        </div>
      </div>
    </div>
  `;
}
