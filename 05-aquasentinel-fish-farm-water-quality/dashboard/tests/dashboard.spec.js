import { test, expect } from '@playwright/test';

const PONDS = ['pond-01', 'pond-02', 'pond-03', 'pond-04'];

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

const STATUS_BY_POND = {
  'pond-01': statusFixture({
    pondId: 'pond-01', doVal: 6.2, waterLevel: 145.0, rateOfChange: 0.02, hypoxiaStage: 'cleared',
    ph: 7.8, temp: 24.5, salinity: 12.0, nitrite: 0.1, pka: 9.1, correctedFraction: 0.0012,
    uiaMgPerL: 0.01, severity: 'safe', brownBlood: false,
    confidence: 0.25, signals: ['ammonia_rising'], feeder: 180, ammonia: 0.4, turbidity: 15.0, orp: 320,
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
const ALERTS_BY_POND = {
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

async function mockApi(page) {
  await page.route('**/ponds/*/status', async (route) => {
    const pondId = pondIdFromUrl(route.request().url());
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(STATUS_BY_POND[pondId]) });
  });
  await page.route('**/ponds/*/alerts', async (route) => {
    const pondId = pondIdFromUrl(route.request().url());
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(ALERTS_BY_POND[pondId]) });
  });
}

test.describe('AquaSentinel dashboard functional flows', () => {
  test('renders one accordion item per pond, collapsed by default', async ({ page }) => {
    await mockApi(page);
    await page.goto('/');

    const items = page.locator('#pond-accordion .accordion-item');
    await expect(items).toHaveCount(PONDS.length);
    for (const pondId of PONDS) {
      await expect(page.locator(`.accordion-item[data-pond-item="${pondId}"]`)).toBeVisible();
    }
    // collapsed by default — no accordion-collapse should carry the 'show' class yet
    await expect(page.locator('#pond-accordion .accordion-collapse.show')).toHaveCount(0);
  });

  test('expanding a pond reveals all 10 raw sensor values in some form', async ({ page }) => {
    await mockApi(page);
    await page.goto('/');

    await page.locator('.accordion-item[data-pond-item="pond-01"] .accordion-button').click();
    const metrics = page.locator('[data-pond-metrics="pond-01"]');
    await expect(metrics).toContainText('6.20'); // dissolved-oxygen
    await expect(metrics).toContainText('24.5'); // water-temperature
    await expect(metrics).toContainText('7.80'); // ph
    await expect(metrics).toContainText('12.0'); // salinity
    await expect(metrics).toContainText('15.0'); // turbidity
    await expect(metrics).toContainText('0.40'); // ammonia-nh3-total
    await expect(metrics).toContainText('0.100'); // nitrite-no2
    await expect(metrics).toContainText('320'); // orp
    await expect(metrics).toContainText('145.0'); // water-level
    await expect(metrics).toContainText('180'); // feeder-load-cell
  });

  test('expanding a pond reveals toxicity detail with UIA calculation provenance', async ({ page }) => {
    await mockApi(page);
    await page.goto('/');

    await page.locator('.accordion-item[data-pond-item="pond-02"] .accordion-button').click();
    const toxicity = page.locator('[data-pond-toxicity="pond-02"]');
    await expect(toxicity).toBeVisible();
    await expect(toxicity).toContainText('toxic');
    await expect(toxicity).toContainText('8.40');
    await expect(toxicity).toContainText('29.0');
    await expect(toxicity).toContainText('18.0');
    await expect(toxicity).toContainText('0.052000');
    await expect(toxicity).toContainText('0.600'); // nitrite-no2 provenance
  });

  test('expanding a pond reveals its hypoxia watch entries sourced from /status, not /alerts', async ({ page }) => {
    await mockApi(page);
    await page.goto('/');

    // pond-02's /alerts fixture carries no life_support entry at all -- if this panel still
    // rendered, it would prove the fix reads /status (latest_readings) instead of /alerts.
    await page.locator('.accordion-item[data-pond-item="pond-02"] .accordion-button').click();
    const hypoxiaRows = page.locator('[data-pond-hypoxia-table="pond-02"] tbody tr');
    await expect(hypoxiaRows).toHaveCount(1);
    await expect(hypoxiaRows.first()).toContainText('hypoxia_critical');
    await expect(hypoxiaRows.first()).toContainText('140.0'); // water_level context field

    // a pond with a cleared stage shows an empty state, not a blank table
    await page.locator('.accordion-item[data-pond-item="pond-01"] .accordion-button').click();
    await expect(page.locator('[data-pond-hypoxia="pond-01"]')).toContainText('No active hypoxia watch');
  });

  test('expanding a pond reveals its feed correlation signals sourced from /status, not /alerts', async ({ page }) => {
    await mockApi(page);
    await page.goto('/');

    // pond-03's /alerts fixture is empty -- this panel can only render from /status.
    await page.locator('.accordion-item[data-pond-item="pond-03"] .accordion-button').click();
    const feedRows = page.locator('[data-pond-feed-table="pond-03"] tbody tr');
    await expect(feedRows).toHaveCount(1);
    await expect(feedRows.first()).toContainText('0.75');
    await expect(feedRows.first()).toContainText('ammonia_rising');
    await expect(feedRows.first()).toContainText('240'); // feeder-load-cell
    await expect(feedRows.first()).toContainText('0.90'); // ammonia-nh3-total
    await expect(feedRows.first()).toContainText('12.0'); // turbidity
    await expect(feedRows.first()).toContainText('210'); // orp

    // a pond with zero contributing signals shows an empty state, not a blank table
    await page.locator('.accordion-item[data-pond-item="pond-04"] .accordion-button').click();
    await expect(page.locator('[data-pond-feed="pond-04"]')).toContainText('No feed correlation signal');
  });

  test('alert ledger renders only genuine urgent-toxicity alerts chronologically', async ({ page }) => {
    await mockApi(page);
    await page.goto('/');

    // the dispatcher never routes life_support/ops_feed_correlation to /alerts, so the ledger
    // -- which reads straight off getAllAlerts() -- must show only the one real toxicity alert.
    const ledgerRows = page.locator('#alert-ledger-body tr');
    await expect(ledgerRows).toHaveCount(1);
    await expect(ledgerRows.first()).toContainText('toxicity');
    await expect(ledgerRows.first()).toContainText('pond-02');
  });

  test('connection banner shows when API is unreachable', async ({ page }) => {
    await page.route('**/ponds/*/status', (route) => route.abort());
    await page.route('**/ponds/*/alerts', (route) => route.abort());
    await page.goto('/');

    await expect(page.locator('#connection-banner')).toBeVisible();
    // each pond still gets its own real-id accordion item, marked offline, rather than a blank list
    await expect(page.locator('.accordion-item[data-pond-item="pond-01"]')).toContainText('offline');
  });

  test('accordion reflows to a single column at mobile width', async ({ page }) => {
    await mockApi(page);
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto('/');

    const topbar = page.locator('nav.app-topbar');
    await expect(topbar).toBeVisible();
    const accordion = page.locator('#pond-accordion');
    const box = await accordion.boundingBox();
    expect(box.width).toBeLessThanOrEqual(390);

    // expanded metric grid reflows to 2-per-row instead of the desktop's wider columns
    await page.locator('.accordion-item[data-pond-item="pond-01"] .accordion-button').click();
    const metricCol = page.locator('[data-pond-metrics="pond-01"] > div').first();
    const colBox = await metricCol.boundingBox();
    expect(colBox.width).toBeLessThan(300);
  });
});
