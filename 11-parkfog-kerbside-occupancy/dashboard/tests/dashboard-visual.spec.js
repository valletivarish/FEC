// @ts-check
const { test, expect } = require('@playwright/test');

const STABLE_MOCK_EVENTS = [
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
    bayId: 'bay-03',
    state: 'OCCUPIED',
    fusedVote: 0.65,
    disabledBayViolation: false,
    timestamp: '2026-07-03T09:02:00.000Z',
  },
  {
    type: 'bay_state_event',
    bayId: 'bay-04',
    state: 'UNOCCUPIED',
    fusedVote: 0.10,
    disabledBayViolation: false,
    timestamp: '2026-07-03T09:03:00.000Z',
  },
  {
    type: 'bay_state_event',
    bayId: 'bay-05',
    state: 'OCCUPIED',
    fusedVote: 0.81,
    disabledBayViolation: true,
    timestamp: '2026-07-03T09:04:00.000Z',
  },
  {
    type: 'bay_state_event',
    bayId: 'bay-06',
    state: 'OCCUPIED',
    fusedVote: 0.70,
    disabledBayViolation: false,
    timestamp: '2026-07-03T09:05:00.000Z',
  },
  {
    type: 'overstay_event',
    bayId: 'bay-03',
    purchasedMinutesRemaining: 0,
    anprConfidence: 40,
    timestamp: '2026-07-03T09:06:00.000Z',
  },
  {
    type: 'zone_pressure_event',
    zoneId: 'zone-01',
    entryPressureEwma: 4.2,
    timestamp: '2026-07-03T09:07:00.000Z',
  },
  {
    type: 'flood_risk_event',
    zoneId: 'zone-01',
    band: 'caution',
    averageFloodLevel: 85,
    timestamp: '2026-07-03T09:08:00.000Z',
  },
  {
    type: 'ev_fault_event',
    bayId: 'bay-06',
    timestamp: '2026-07-03T09:09:00.000Z',
  },
  {
    type: 'camera_discrepancy_event',
    zoneId: 'zone-01',
    cameraFreeCount: 3,
    fusedFreeCount: 1,
    occlusionPercent: 8,
    timestamp: '2026-07-03T09:09:20.000Z',
  },
  {
    type: 'tariff_changed',
    entityId: 'zone-01',
    previousTariff: 2.0,
    newTariff: 3.2,
    demandSignal: 17,
    timestamp: '2026-07-03T09:10:00.000Z',
  },
];

async function mockZoneStatus(page) {
  await page.route('**/zones/zone-01/status', (route) => {
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ zoneId: 'zone-01', events: STABLE_MOCK_EVENTS }),
    });
  });
}

test.describe('ParkFog dashboard — visual regression', () => {
  test('desktop full-page snapshot with populated data', async ({ page }) => {
    await mockZoneStatus(page);
    await page.setViewportSize({ width: 1280, height: 800 });
    await page.goto('/');
    await expect(page.locator('#bay-status-body .bay-tile')).toHaveCount(6);
    await expect(page).toHaveScreenshot('dashboard-desktop.png', { fullPage: true });
  });

  test('mobile full-page snapshot with populated data', async ({ page }) => {
    await mockZoneStatus(page);
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto('/');
    await expect(page.locator('#bay-status-body .bay-tile')).toHaveCount(6);
    await expect(page).toHaveScreenshot('dashboard-mobile.png', { fullPage: true });
  });
});
