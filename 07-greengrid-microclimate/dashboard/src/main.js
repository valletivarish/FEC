import { GreenGridApiClient } from './api/greengridApiClient.js';
import { renderSummaryKpiRow } from './components/summaryKpiRow.js';
import { renderStationOverviewGrid } from './components/stationOverviewGrid.js';
import { renderWeatherWatchCard } from './components/weatherWatchCard.js';
import { renderSoilRisksTable } from './components/soilRisksTable.js';
import { renderPollutionWatchTable } from './components/pollutionWatchTable.js';
import { renderEventLogTable, sortEventsNewestFirst } from './components/eventLogTable.js';

// Three fixed monitoring stations per the campus deployment — not discovered
// dynamically since the fog layer runs one process per station.
const STATION_IDS = ['station-quad', 'station-north-lawn', 'station-arboretum'];
const API_BASE_URL = window.GREENGRID_API_BASE_URL ?? 'http://localhost:3000';

function showEmptyState(show) {
  document.getElementById('empty-state').classList.toggle('d-none', !show);
}

function renderAll(events) {
  const sorted = sortEventsNewestFirst(events);

  renderSummaryKpiRow(document.getElementById('summary-kpi-row'), sorted, STATION_IDS);
  renderStationOverviewGrid(document.getElementById('station-overview-grid'), sorted, STATION_IDS);
  renderWeatherWatchCard(document.getElementById('weather-watch-card'), sorted);
  renderSoilRisksTable(document.getElementById('soil-risks-body'), sorted);
  renderPollutionWatchTable(document.getElementById('pollution-watch-body'), sorted);
  renderEventLogTable(document.getElementById('event-log-body'), sorted);
}

export async function loadDashboard(apiBaseUrl = API_BASE_URL) {
  const client = new GreenGridApiClient(apiBaseUrl);

  const results = await Promise.allSettled(
    STATION_IDS.map((stationId) => client.getStationEvents(stationId))
  );

  const events = results
    .filter((result) => result.status === 'fulfilled')
    .flatMap((result) => (Array.isArray(result.value) ? result.value : result.value.events ?? []));

  const allFailed = results.every((result) => result.status === 'rejected');

  if (allFailed || events.length === 0) {
    showEmptyState(true);
  } else {
    showEmptyState(false);
  }

  renderAll(events);
}

if (typeof window !== 'undefined' && !window.__GREENGRID_SKIP_AUTOLOAD__) {
  loadDashboard();
}
