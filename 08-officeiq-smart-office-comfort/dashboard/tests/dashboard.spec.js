import { test, expect } from '@playwright/test';

const ZONE_IDS = ['zone-101', 'zone-102', 'zone-201', 'zone-202'];

// Matches the real getZoneStatus response shape: per-type event lists plus the context
// fields each fog node's own event payload actually carries (no raw-sensor passthrough).
function statusFor(zoneId) {
  return {
    zoneId,
    deskOccupancy: 4,
    roomCo2: 850,
    roomTemperature: 22,
    status: 'nominal',
    occupancyEvents:
      zoneId === 'zone-101'
        ? [
            {
              type: 'occupancy_event',
              zoneId: 'zone-101',
              verdict: 'STANDING_ROOM',
              deskOccupiedCount: 3,
              netPeopleCount: 7,
              resolvedHeadcount: 5,
              timestamp: '2026-07-01T09:00:00.000Z',
            },
          ]
        : [],
    comfortEvents:
      zoneId === 'zone-102'
        ? [
            {
              type: 'comfort_event',
              zoneId: 'zone-102',
              verdict: 'VENTILATION_ANOMALY',
              severity: 'critical',
              co2Slope: 20,
              roomCo2: 1080,
              pressureDifferential: 1,
              humidity: 48,
              windowState: 0,
              temperature: 24,
              noiseLevel: 38,
              timestamp: '2026-07-01T09:05:00.000Z',
            },
          ]
        : [],
    usageEvents:
      zoneId === 'zone-201'
        ? [
            {
              type: 'usage_event',
              zoneId: 'zone-201',
              verdict: 'DEVICE_LEFT_ON',
              estimatedWattHoursWasted: 12.5,
              plugPower: 42,
              lightLevel: 610,
              timestamp: '2026-07-01T09:10:00.000Z',
            },
          ]
        : [],
    scalingStatus: zoneId === 'zone-101' ? { desiredCount: 8, runningCount: 3 } : { desiredCount: 1, runningCount: 1 },
  };
}

async function mockPopulatedApi(page) {
  await page.route('**/zones/*/status', async (route) => {
    const url = route.request().url();
    const zoneId = ZONE_IDS.find((id) => url.includes(id));
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(statusFor(zoneId)) });
  });
}

test.describe('OfficeIQ dashboard — functional', () => {
  test('renders a zone overview row per zone under "All Zones"', async ({ page }) => {
    await mockPopulatedApi(page);
    await page.goto('/');

    const rows = page.locator('#zone-overview-body tr');
    await expect(rows).toHaveCount(4);
    for (const zoneId of ZONE_IDS) {
      await expect(page.locator('#zone-overview-body')).toContainText(zoneId);
    }
    // zone overview surfaces desk-occupancy, room-co2, room-temperature raw context values
    await expect(rows.first()).toContainText('4');
    await expect(rows.first()).toContainText('850');
    await expect(rows.first()).toContainText('22');
  });

  test('renders occupancy reconciliation entries with correct badge and desk/people counts', async ({ page }) => {
    await mockPopulatedApi(page);
    await page.goto('/');

    const row = page.locator('#occupancy-reconciliation-body tr').first();
    await expect(row).toContainText('zone-101');
    await expect(row.locator('.badge')).toContainText('STANDING_ROOM');
    await expect(row.locator('.badge')).toHaveClass(/text-bg-warning/);
    // desk-occupancy and people-counter raw values
    await expect(row).toContainText('3');
    await expect(row).toContainText('7');
  });

  test('renders comfort events with verdict, severity badges, and humidity/window/noise context', async ({ page }) => {
    await mockPopulatedApi(page);
    await page.goto('/');

    const row = page.locator('#comfort-events-body tr').first();
    await expect(row).toContainText('zone-102');
    await expect(row).toContainText('VENTILATION_ANOMALY');
    await expect(row).toContainText('critical');
    // room-humidity, window-state, meeting-room-noise raw context values
    await expect(row).toContainText('48');
    await expect(row).toContainText('closed');
    await expect(row).toContainText('38');
  });

  test('renders usage/waste entries with verdict badge and plug-power/light-level context', async ({ page }) => {
    await mockPopulatedApi(page);
    await page.goto('/');

    const row = page.locator('#usage-waste-body tr').first();
    await expect(row).toContainText('zone-201');
    await expect(row).toContainText('DEVICE_LEFT_ON');
    await expect(row).toContainText('12.5 Wh');
    // plug-power and light-level raw context values
    await expect(row).toContainText('42');
    await expect(row).toContainText('610');
  });

  test('scaling status card shows running/desired task count', async ({ page }) => {
    await mockPopulatedApi(page);
    await page.goto('/');

    const card = page.locator('#scaling-status-card');
    await expect(card).toContainText('3 / 8 tasks running');
  });

  test('nav-pills default to "All Zones" with matching breadcrumb', async ({ page }) => {
    await mockPopulatedApi(page);
    await page.goto('/');

    const allZonesPill = page.locator('#zone-pill-nav .nav-link', { hasText: 'All Zones' });
    await expect(allZonesPill).toHaveClass(/active/);
    await expect(page.locator('#zone-breadcrumb-current')).toHaveText('All Zones');
  });

  test('selecting a zone pill updates breadcrumb and filters every table to that zone', async ({ page }) => {
    await mockPopulatedApi(page);
    await page.goto('/');

    await page.locator('#zone-pill-nav .nav-link', { hasText: 'Zone 101' }).click();

    await expect(page.locator('#zone-breadcrumb-current')).toHaveText('Zone 101');
    await expect(page.locator('#zone-pill-nav .nav-link', { hasText: 'Zone 101' })).toHaveClass(/active/);
    await expect(page.locator('#zone-pill-nav .nav-link', { hasText: 'All Zones' })).not.toHaveClass(/active/);

    const overviewRows = page.locator('#zone-overview-body tr');
    await expect(overviewRows).toHaveCount(1);
    await expect(overviewRows.first()).toContainText('zone-101');

    // zone-101 is the only zone with occupancy events in this fixture, and no comfort/usage events.
    await expect(page.locator('#occupancy-reconciliation-body tr')).toHaveCount(1);
    await expect(page.locator('#comfort-events-body tr')).toHaveCount(0);
    await expect(page.locator('#usage-waste-body tr')).toHaveCount(0);
  });

  test('switching back to "All Zones" restores the full data set', async ({ page }) => {
    await mockPopulatedApi(page);
    await page.goto('/');

    await page.locator('#zone-pill-nav .nav-link', { hasText: 'Zone 102' }).click();
    await expect(page.locator('#zone-overview-body tr')).toHaveCount(1);

    await page.locator('#zone-pill-nav .nav-link', { hasText: 'All Zones' }).click();
    await expect(page.locator('#zone-breadcrumb-current')).toHaveText('All Zones');
    await expect(page.locator('#zone-overview-body tr')).toHaveCount(4);
  });

  test('responsive layout: nav-pills and breadcrumb remain visible at mobile width', async ({ page }) => {
    await mockPopulatedApi(page);
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto('/');

    const table = page.locator('#zone-overview-body').first();
    await expect(table).toBeVisible();
    const rail = page.locator('.officeiq-rail');
    await expect(rail).toBeVisible();
    await expect(page.locator('#zone-pill-nav')).toBeVisible();
    await expect(page.locator('#zone-breadcrumb-current')).toBeVisible();
  });

  test('renders explanatory empty state with no live backend', async ({ page }) => {
    await page.route('**/zones/*/status', async (route) => {
      await route.fulfill({ status: 500, contentType: 'application/json', body: JSON.stringify({ error: 'down' }) });
    });
    await page.goto('/');

    const emptyState = page.locator('#empty-state');
    await expect(emptyState).toBeVisible();
    await expect(emptyState).toContainText('No live data — start the local stack to see readings');

    await expect(page.locator('.officeiq-rail')).toBeVisible();
    await expect(page.locator('h2', { hasText: 'Zone Overview' })).toBeVisible();
    await expect(page.locator('#zone-overview-body tr')).toHaveCount(0);
  });
});
