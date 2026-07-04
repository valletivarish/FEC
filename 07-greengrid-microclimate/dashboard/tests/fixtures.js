// Shared mock event fixtures, keyed by station, mirroring the real event contract exactly.
export const STATION_EVENTS = {
  'station-quad': {
    events: [
      {
        type: 'weather_event',
        station_id: 'station-quad',
        storm_risk_score: 78.5,
        mean_wind_speed: 14.2,
        mean_wind_direction: 210,
        barometric_slope: -1.8,
        uv_index: 2.3,
        timestamp: '2026-07-01T12:00:00Z',
      },
      {
        type: 'soil_event',
        station_id: 'station-quad',
        risk: 'irrigation_need',
        severity: null,
        timestamp: '2026-07-01T11:45:00Z',
      },
    ],
  },
  'station-north-lawn': {
    events: [
      {
        type: 'soil_event',
        station_id: 'station-north-lawn',
        risk: 'frost_risk',
        severity: 'warning',
        timestamp: '2026-07-01T11:50:00Z',
      },
      {
        type: 'pollution_event',
        station_id: 'station-north-lawn',
        metric: 'pm2-5',
        rolling_p95: 62.3,
        exceedance_count: 6,
        timestamp: '2026-07-01T11:55:00Z',
      },
    ],
  },
  'station-arboretum': {
    events: [
      {
        type: 'pollution_event',
        station_id: 'station-arboretum',
        metric: 'ambient-noise',
        rolling_p95: 55.1,
        exceedance_count: 3,
        timestamp: '2026-07-01T11:40:00Z',
      },
      {
        type: 'soil_event',
        station_id: 'station-arboretum',
        risk: 'disease_risk',
        severity: null,
        timestamp: '2026-07-01T11:35:00Z',
      },
    ],
  },
};

export async function mockGreenGridApi(page, stationEvents = STATION_EVENTS) {
  await page.route('**/stations/*/events', async (route) => {
    const url = new URL(route.request().url());
    const stationId = url.pathname.split('/')[2];
    const body = stationEvents[stationId] ?? { events: [] };
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(body) });
  });
}

export async function mockGreenGridApiEmpty(page) {
  await page.route('**/stations/*/events', async (route) => {
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ events: [] }) });
  });
}
