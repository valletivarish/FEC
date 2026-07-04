import { test, expect } from '@playwright/test';

const STABLE_ZONE_FIXTURES = {
  'zone-a': {
    zoneId: 'zone-a',
    latestCommand: { zoneId: 'zone-a', ventPositionSetpoint: 55, vpdKpa: 1.05, timestamp: '2026-07-02T10:00:00.000Z' },
    faults: [
      {
        type: 'enclosure_fault_event',
        eventTypeTimestamp: 'enclosure_fault_event#2026-07-02T10:05:00.000Z',
        faultState: 'ENCLOSURE_OK',
        ventPositionActual: 58,
        ventPositionSetpoint: 55,
        timestamp: '2026-07-02T10:05:00.000Z',
        acknowledged: false
      },
      {
        type: 'fertigation_event',
        eventTypeTimestamp: 'fertigation_event#2026-07-02T09:50:00.000Z',
        zoneId: 'zone-a',
        metric: 'ec',
        severity: 'OK',
        value: 2.1,
        slopePerReading: 0.05,
        doseDirection: null,
        lowMoisture: false,
        temperatureCompensationNeeded: true,
        timestamp: '2026-07-02T09:50:00.000Z',
        acknowledged: false
      },
      {
        type: 'fertigation_event',
        eventTypeTimestamp: 'fertigation_event#2026-07-02T09:51:00.000Z',
        zoneId: 'zone-a',
        metric: 'water-temperature',
        severity: 'WARNING',
        value: 31.4,
        slopePerReading: null,
        doseDirection: null,
        lowMoisture: false,
        temperatureCompensationNeeded: true,
        timestamp: '2026-07-02T09:51:00.000Z',
        acknowledged: false
      }
    ]
  },
  'zone-b': {
    zoneId: 'zone-b',
    latestCommand: { zoneId: 'zone-b', ventPositionSetpoint: 40, vpdKpa: 0.7, timestamp: '2026-07-02T10:00:00.000Z' },
    faults: [
      {
        type: 'enclosure_fault_event',
        eventTypeTimestamp: 'enclosure_fault_event#2026-07-02T10:06:00.000Z',
        faultState: 'VENT_STALL',
        ventPositionActual: 20,
        ventPositionSetpoint: 40,
        timestamp: '2026-07-02T10:06:00.000Z',
        acknowledged: false
      },
      {
        type: 'fertigation_event',
        eventTypeTimestamp: 'fertigation_event#2026-07-02T09:55:00.000Z',
        zoneId: 'zone-b',
        metric: 'ph',
        severity: 'WARNING',
        value: 6.7,
        slopePerReading: 0.42,
        doseDirection: 'decrease_ph_buffer',
        lowMoisture: false,
        timestamp: '2026-07-02T09:55:00.000Z',
        acknowledged: false
      }
    ]
  },
  'zone-c': {
    zoneId: 'zone-c',
    latestCommand: { zoneId: 'zone-c', ventPositionSetpoint: 15, vpdKpa: 1.4, timestamp: '2026-07-02T10:00:00.000Z' },
    faults: [
      {
        type: 'enclosure_breach_event',
        eventTypeTimestamp: 'enclosure_breach_event#2026-07-02T10:07:00.000Z',
        doorOpen: true,
        ventPositionSetpoint: 15,
        timestamp: '2026-07-02T10:07:00.000Z',
        acknowledged: false
      },
      {
        type: 'dli_event',
        eventTypeTimestamp: 'dli_event#2026-07-02T18:00:00.000Z',
        accumulatedDli: 12.4,
        shortfall: true,
        timestamp: '2026-07-02T18:00:00.000Z'
      }
    ]
  }
};

async function mockZoneRoutes(page) {
  await page.route('**/zones/*/status', async (route) => {
    const url = route.request().url();
    const match = url.match(/zones\/([^/]+)\/status/);
    const zoneId = match[1];
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(STABLE_ZONE_FIXTURES[zoneId])
    });
  });
}

test.describe('GreenhouseGuard dashboard - visual regression', () => {
  test('desktop full-page screenshot with populated data', async ({ page }) => {
    await mockZoneRoutes(page);
    await page.goto('/');
    await expect(page.locator('.bench-row-card')).toHaveCount(3);
    await expect(page).toHaveScreenshot('dashboard-desktop-populated.png', { fullPage: true });
  });

  test('mobile full-page screenshot with populated data', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await mockZoneRoutes(page);
    await page.goto('/');
    await expect(page.locator('.bench-row-card')).toHaveCount(3);
    await expect(page).toHaveScreenshot('dashboard-mobile-populated.png', { fullPage: true });
  });
});
