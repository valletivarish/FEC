// @ts-check
const { test, expect } = require('@playwright/test');

const MOCK_EVENTS = [
  {
    type: 'bay_state_event',
    bayId: 'bay-01',
    state: 'OCCUPIED',
    fusedVote: 0.72,
    disabledBayViolation: false,
    timestamp: '2026-07-03T09:00:00.000Z',
  },
  {
    type: 'bay_state_event',
    bayId: 'bay-02',
    state: 'UNOCCUPIED',
    fusedVote: 0.18,
    disabledBayViolation: false,
    timestamp: '2026-07-03T09:01:00.000Z',
  },
  {
    type: 'bay_state_event',
    bayId: 'bay-05',
    state: 'OCCUPIED',
    fusedVote: 0.81,
    disabledBayViolation: true,
    timestamp: '2026-07-03T09:02:00.000Z',
  },
  {
    type: 'overstay_event',
    bayId: 'bay-03',
    purchasedMinutesRemaining: 0,
    anprConfidence: 40,
    timestamp: '2026-07-03T09:03:00.000Z',
  },
  {
    type: 'zone_pressure_event',
    zoneId: 'zone-01',
    entryPressureEwma: 4.2,
    timestamp: '2026-07-03T09:04:00.000Z',
  },
  {
    type: 'flood_risk_event',
    zoneId: 'zone-01',
    band: 'caution',
    averageFloodLevel: 85,
    timestamp: '2026-07-03T09:05:00.000Z',
  },
  {
    type: 'ev_fault_event',
    bayId: 'bay-06',
    timestamp: '2026-07-03T09:06:00.000Z',
  },
  {
    type: 'tariff_changed',
    entityId: 'zone-01',
    previousTariff: 2.0,
    newTariff: 3.2,
    demandSignal: 17,
    timestamp: '2026-07-03T09:07:00.000Z',
  },
];

async function mockZoneStatus(page, events) {
  await page.route('**/zones/zone-01/status', (route) => {
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ zoneId: 'zone-01', events }),
    });
  });
}

test.describe('ParkFog dashboard — functional', () => {
  test('renders a bay tile per bay', async ({ page }) => {
    await mockZoneStatus(page, MOCK_EVENTS);
    await page.goto('/');

    const tiles = page.locator('#bay-status-body .bay-tile');
    await expect(tiles).toHaveCount(6);

    const bay01Tile = page.locator('.bay-tile[data-bay-id="bay-01"]');
    await expect(bay01Tile).toContainText('bay-01');
    await expect(bay01Tile.locator('.bay-state-badge')).toContainText('OCCUPIED');
    await expect(bay01Tile.locator('.bay-state-badge')).toHaveClass(/text-bg-danger/);

    const bay02Tile = page.locator('.bay-tile[data-bay-id="bay-02"]');
    await expect(bay02Tile.locator('.bay-state-badge')).toContainText('AVAILABLE');
    await expect(bay02Tile.locator('.bay-state-badge')).toHaveClass(/text-bg-success/);

    const bay05Tile = page.locator('.bay-tile[data-bay-id="bay-05"]');
    await expect(bay05Tile.locator('.badge', { hasText: 'VIOLATION' })).toBeVisible();

    const bay06Tile = page.locator('.bay-tile[data-bay-id="bay-06"]');
    await expect(bay06Tile.locator('.bay-ev-badge', { hasText: 'EV' })).toBeVisible();
  });

  test('renders overstay and pressure entries with correct pill badges', async ({ page }) => {
    await mockZoneStatus(page, MOCK_EVENTS);
    await page.goto('/');

    const overstayRow = page.locator('#overstay-pressure-body tr', { hasText: 'bay-03' });
    await expect(overstayRow.locator('.badge.text-bg-warning')).toBeVisible();

    const pressureRow = page.locator('#overstay-pressure-body tr', { hasText: 'zone-01' });
    await expect(pressureRow.locator('.badge.text-bg-success')).toBeVisible();
  });

  test('renders a tariff change line in the debounce trace panel', async ({ page }) => {
    await mockZoneStatus(page, MOCK_EVENTS);
    await page.goto('/');

    const traceLog = page.locator('#debounce-trace-log');
    await expect(traceLog).toContainText('£2.00→£3.20');
    await expect(traceLog).toContainText('demand-triggered');
  });

  test('renders kerb conditions with flood band and EV fault badges', async ({ page }) => {
    await mockZoneStatus(page, MOCK_EVENTS);
    await page.goto('/');

    const floodRow = page.locator('#kerb-conditions-body tr', { hasText: 'flood risk' });
    await expect(floodRow.locator('.badge.text-bg-warning', { hasText: 'caution' })).toBeVisible();

    const evFaultRow = page.locator('#kerb-conditions-body tr', { hasText: 'bay-06' });
    await expect(evFaultRow.locator('.badge.text-bg-danger', { hasText: 'fault' })).toBeVisible();
  });

  test('renders a chronological event log, most recent first', async ({ page }) => {
    await mockZoneStatus(page, MOCK_EVENTS);
    await page.goto('/');

    const rows = page.locator('#event-log-body tr');
    await expect(rows).toHaveCount(MOCK_EVENTS.length);
    await expect(rows.first()).toContainText('zone-01');
    await expect(rows.first()).toContainText('£2.00 → £3.20');
  });

  test('bay grid reflows from 6 columns on desktop to 2 on mobile', async ({ page }) => {
    await mockZoneStatus(page, MOCK_EVENTS);

    await page.setViewportSize({ width: 1280, height: 800 });
    await page.goto('/');

    const tiles = page.locator('#bay-status-body .bay-tile');
    await expect(tiles).toHaveCount(6);

    const bay01Box = await page.locator('.bay-tile[data-bay-id="bay-01"]').boundingBox();
    const bay02Box = await page.locator('.bay-tile[data-bay-id="bay-02"]').boundingBox();
    // At desktop width (row-cols-lg-6) all 6 tiles share one row, so bay-02 sits beside bay-01.
    expect(bay02Box.y).toBeCloseTo(bay01Box.y, 0);

    await page.setViewportSize({ width: 390, height: 844 });
    await page.reload();

    const header = page.locator('.app-header');
    await expect(header).toBeVisible();
    const headerBox = await header.boundingBox();
    expect(headerBox.width).toBeLessThanOrEqual(390);

    await expect(page.locator('#bay-status-body .bay-tile')).toHaveCount(6);
    // At mobile width (row-cols-2) only 2 tiles share a row, so bay-03 wraps to a new row.
    const bay01BoxMobile = await page.locator('.bay-tile[data-bay-id="bay-01"]').boundingBox();
    const bay03BoxMobile = await page.locator('.bay-tile[data-bay-id="bay-03"]').boundingBox();
    expect(bay03BoxMobile.y).toBeGreaterThan(bay01BoxMobile.y);
  });

  test('renders the no-backend empty state with explanatory message', async ({ page }) => {
    await page.route('**/zones/zone-01/status', (route) => {
      route.abort('failed');
    });
    await page.goto('/');

    await expect(page.locator('#empty-state')).toBeVisible();
    await expect(page.locator('#empty-state')).toContainText(
      'No live data — start the local stack to see readings'
    );

    await expect(page.locator('.app-sidebar')).toBeVisible();
    await expect(page.locator('h2', { hasText: 'Bay Status' })).toBeVisible();

    // Full page shell still renders: all 6 bay tiles with real bay ids, showing UNKNOWN (never blank).
    const tiles = page.locator('#bay-status-body .bay-tile');
    await expect(tiles).toHaveCount(6);
    await expect(page.locator('.bay-tile[data-bay-id="bay-01"] .bay-state-badge')).toContainText('UNKNOWN');
  });
});
