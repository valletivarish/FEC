import { test, expect } from '@playwright/test';

const ZONE_IDS = ['zone-101', 'zone-102', 'zone-201', 'zone-202'];

// Stable, populated fixture data — deterministic timestamps so screenshots don't drift run to run.
// Matches the real getZoneStatus response shape (per-type event lists carrying each fog
// node's own context fields — no raw-sensor passthrough).
function statusFor(zoneId) {
  const base = {
    zoneId,
    deskOccupancy: 3,
    roomCo2: 900,
    roomTemperature: 21,
    status: 'nominal',
    occupancyEvents: [],
    comfortEvents: [],
    usageEvents: [],
    scalingStatus: { desiredCount: 1, runningCount: 1 },
  };

  if (zoneId === 'zone-101') {
    return {
      ...base,
      status: 'critical',
      occupancyEvents: [
        {
          type: 'occupancy_event',
          zoneId: 'zone-101',
          verdict: 'SENSOR_DRIFT',
          deskOccupiedCount: 6,
          netPeopleCount: 2,
          resolvedHeadcount: 4,
          timestamp: '2026-07-01T09:00:00.000Z',
        },
      ],
      scalingStatus: { desiredCount: 8, runningCount: 5 },
    };
  }

  if (zoneId === 'zone-102') {
    return {
      ...base,
      status: 'elevated',
      comfortEvents: [
        {
          type: 'comfort_event',
          zoneId: 'zone-102',
          verdict: 'VENTILATION_ANOMALY',
          severity: 'elevated',
          co2Slope: 18,
          roomCo2: 1040,
          pressureDifferential: 2,
          humidity: 64,
          windowState: 0,
          temperature: 25,
          noiseLevel: 55,
          timestamp: '2026-07-01T09:05:00.000Z',
        },
        {
          type: 'comfort_event',
          zoneId: 'zone-102',
          verdict: 'PRESSURE_FAULT',
          severity: null,
          co2Slope: 18,
          roomCo2: 1040,
          pressureDifferential: 14,
          humidity: 64,
          windowState: 0,
          temperature: 25,
          noiseLevel: 55,
          timestamp: '2026-07-01T09:06:00.000Z',
        },
      ],
    };
  }

  if (zoneId === 'zone-201') {
    return {
      ...base,
      status: 'critical',
      usageEvents: [
        {
          type: 'usage_event',
          zoneId: 'zone-201',
          verdict: 'DEVICE_LEFT_ON_ESCALATED',
          estimatedWattHoursWasted: 40,
          plugPower: 65,
          lightLevel: 720,
          timestamp: '2026-07-01T09:10:00.000Z',
        },
      ],
    };
  }

  return base;
}

test.describe('OfficeIQ dashboard — visual regression', () => {
  test.beforeEach(async ({ page }) => {
    await page.route('**/zones/*/status', async (route) => {
      const url = route.request().url();
      const zoneId = ZONE_IDS.find((id) => url.includes(id));
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(statusFor(zoneId)) });
    });
  });

  test('desktop full-page snapshot with populated data', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 800 });
    await page.goto('/');
    await expect(page.locator('#zone-overview-body tr')).toHaveCount(4);
    await expect(page).toHaveScreenshot('officeiq-dashboard-desktop.png', { fullPage: true });
  });

  test('mobile full-page snapshot with populated data', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto('/');
    await expect(page.locator('#zone-overview-body tr')).toHaveCount(4);
    await expect(page).toHaveScreenshot('officeiq-dashboard-mobile.png', { fullPage: true });
  });
});
