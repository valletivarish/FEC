import { test, expect } from '@playwright/test';

// Shape matches the real pond_query handler: latest_readings holds one item per fog event
// TYPE (life_support/toxicity/ops_feed_correlation), each wrapping its dispatched fields in
// .payload -- there is no raw per-metric readings array, by design. Hypoxia Watch and Feed
// Correlation panels read life_support/ops_feed_correlation straight from this /status shape,
// never from /alerts -- the dispatcher only ever routes urgent toxicity there.
function statusFixture({ pondId, doVal, waterLevel, rateOfChange, ph, temp, salinity, nitrite, pka, correctedFraction,
  uiaMgPerL, severity, brownBlood, confidence, signals, feeder, ammonia, turbidity, orp, hypoxiaStage }) {
  const readings = [
    {
      pond_id: pondId,
      type: 'life_support',
      timestamp: '2026-07-02T10:00:00Z',
      payload: { stage: hypoxiaStage, dissolved_oxygen: doVal, rate_of_change: rateOfChange, water_level: waterLevel },
    },
    {
      pond_id: pondId,
      type: 'toxicity',
      timestamp: '2026-07-02T10:00:00Z',
      payload: {
        severity,
        uia_mg_per_l: uiaMgPerL,
        nitrite_brown_blood_risk: brownBlood,
        provenance: { ph, water_temperature: temp, salinity, nitrite_no2: nitrite, pka, corrected_fraction: correctedFraction },
      },
    },
  ];
  // OpsFog only ever dispatches once confidence crosses DISPATCH_THRESHOLD, so a pond with no
  // signals genuinely has no ops_feed_correlation item in latest_readings -- not a zero-value one.
  if (confidence > 0) {
    readings.push({
      pond_id: pondId,
      type: 'ops_feed_correlation',
      timestamp: '2026-07-02T10:00:00Z',
      payload: {
        overfeeding_confidence: confidence,
        contributing_signals: signals,
        feeder_load_cell: feeder,
        ammonia_nh3_total: ammonia,
        turbidity,
        orp,
      },
    });
  }
  return { pond_id: pondId, latest_readings: readings };
}

const STABLE_STATUS = {
  'pond-01': statusFixture({
    pondId: 'pond-01', doVal: 6.2, waterLevel: 145.0, rateOfChange: 0.02, hypoxiaStage: 'cleared',
    ph: 7.8, temp: 24.5, salinity: 12.0, nitrite: 0.1, pka: 9.1, correctedFraction: 0.0012,
    uiaMgPerL: 0.01, severity: 'safe', brownBlood: false,
    confidence: 0.0, signals: [], feeder: 180, ammonia: 0.4, turbidity: 15.0, orp: 320,
  }),
  'pond-02': statusFixture({
    pondId: 'pond-02', doVal: 3.5, waterLevel: 140.0, rateOfChange: -0.62, hypoxiaStage: 'hypoxia_critical',
    ph: 8.4, temp: 29.0, salinity: 18.0, nitrite: 0.6, pka: 8.95, correctedFraction: 0.052,
    uiaMgPerL: 0.061, severity: 'toxic', brownBlood: true,
    confidence: 0.75, signals: ['feeder_load_above_median', 'ammonia_rising', 'turbidity_rising'],
    feeder: 260, ammonia: 1.8, turbidity: 40.0, orp: 180,
  }),
  'pond-03': statusFixture({
    pondId: 'pond-03', doVal: 5.5, waterLevel: 150.0, rateOfChange: -0.05, hypoxiaStage: 'cleared',
    ph: 7.5, temp: 22.0, salinity: 10.0, nitrite: 0.2, pka: 9.2, correctedFraction: 0.006,
    uiaMgPerL: 0.03, severity: 'elevated', brownBlood: false,
    confidence: 0.75, signals: ['feeder_load_above_median', 'ammonia_rising', 'turbidity_rising'],
    feeder: 240, ammonia: 0.9, turbidity: 12.0, orp: 210,
  }),
  'pond-04': statusFixture({
    pondId: 'pond-04', doVal: 7.0, waterLevel: 155.0, rateOfChange: 0.01, hypoxiaStage: 'cleared',
    ph: 7.2, temp: 20.0, salinity: 9.0, nitrite: 0.05, pka: 9.3, correctedFraction: 0.0009,
    uiaMgPerL: 0.005, severity: 'safe', brownBlood: false,
    confidence: 0.0, signals: [], feeder: 170, ammonia: 0.3, turbidity: 8.0, orp: 340,
  }),
};

// /alerts only ever carries urgent toxicity -- the dispatcher routes life_support and
// ops_feed_correlation to /readings instead, surfaced to the dashboard via /status.
const STABLE_ALERTS = {
  'pond-01': { alerts: [] },
  'pond-02': {
    alerts: [
      {
        type: 'toxicity',
        pond_id: 'pond-02',
        severity: 'toxic',
        uia_mg_per_l: 0.061,
        nitrite_brown_blood_risk: true,
        provenance: { ph: 8.4, water_temperature: 29.0, salinity: 18.0, nitrite_no2: 0.6, pka: 8.95, corrected_fraction: 0.052 },
        timestamp: '2026-07-02T09:59:00Z',
      },
    ],
  },
  'pond-03': { alerts: [] },
  'pond-04': { alerts: [] },
};

function pondIdFromUrl(url) {
  const match = new URL(url).pathname.match(/\/ponds\/([^/]+)\//);
  return match ? match[1] : null;
}

async function mockStableApi(page) {
  await page.route('**/ponds/*/status', async (route) => {
    const pondId = pondIdFromUrl(route.request().url());
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(STABLE_STATUS[pondId]) });
  });
  await page.route('**/ponds/*/alerts', async (route) => {
    const pondId = pondIdFromUrl(route.request().url());
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(STABLE_ALERTS[pondId]) });
  });
}

test.describe('AquaSentinel dashboard visual regression', () => {
  test('desktop full-page snapshot with stable mocked data', async ({ page }) => {
    await mockStableApi(page);
    await page.goto('/');
    await expect(page.locator('#pond-accordion .accordion-item')).toHaveCount(4);
    await expect(page).toHaveScreenshot('dashboard-desktop.png', { fullPage: true });
  });

  test('mobile full-page snapshot with stable mocked data', async ({ page }) => {
    await mockStableApi(page);
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto('/');
    await expect(page.locator('#pond-accordion .accordion-item')).toHaveCount(4);
    await expect(page).toHaveScreenshot('dashboard-mobile.png', { fullPage: true });
  });

  test('expanded pond snapshot shows genuine Hypoxia Watch and Feed Correlation content', async ({ page }) => {
    await mockStableApi(page);
    await page.goto('/');
    // pond-02 has no life_support/ops_feed_correlation in its /alerts fixture, so this content
    // can only have come from /status -- the same panels the earlier fix wired up.
    await page.locator('.accordion-item[data-pond-item="pond-02"] .accordion-button').click();
    await expect(page.locator('[data-pond-hypoxia-table="pond-02"] tbody tr')).toHaveCount(1);
    await expect(page).toHaveScreenshot('dashboard-pond-expanded.png', { fullPage: true });
  });
});
