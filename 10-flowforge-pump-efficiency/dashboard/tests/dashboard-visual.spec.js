import { test, expect } from '@playwright/test';

// Fixed timestamps and values keep the screenshot deterministic across runs.
const STABLE_INSIGHTS = {
  'pump-01': [
    {
      type: 'health_event',
      pumpId: 'pump-01',
      trigger: 'mad_anomaly',
      madScore: 4.1,
      vibration: 8.3,
      bearingTemp: 71.2,
      motorCurrent: 22.5,
      rpm: 1750,
      timestamp: '2026-01-01T10:00:00Z',
    },
    {
      type: 'hydraulics_event',
      pumpId: 'pump-01',
      severity: 'CRITICAL',
      efficiency: 0.41,
      predictedEfficiency: 0.63,
      deviationPercentagePoints: 22.0,
      timestamp: '2026-01-01T10:01:00Z',
    },
    {
      type: 'integrity_event',
      pumpId: 'pump-01',
      state: 'LEAK_WATCH',
      sealLeak: 34.2,
      trendSlope: 0.12,
      turbidity: 18.4,
      timestamp: '2026-01-01T10:02:00Z',
    },
  ],
  'pump-02': [
    {
      type: 'health_event',
      pumpId: 'pump-02',
      trigger: 'cusum_changepoint',
      madScore: 1.2,
      vibration: 5.1,
      bearingTemp: 60.4,
      motorCurrent: 18.9,
      rpm: 1600,
      timestamp: '2026-01-01T09:55:00Z',
    },
    {
      type: 'hydraulics_event',
      pumpId: 'pump-02',
      severity: 'WARNING',
      efficiency: 0.52,
      predictedEfficiency: 0.61,
      deviationPercentagePoints: 9.0,
      timestamp: '2026-01-01T09:56:00Z',
    },
    {
      type: 'integrity_event',
      pumpId: 'pump-02',
      state: 'LEAK_CRITICAL',
      sealLeak: 48.7,
      trendSlope: 0.55,
      turbidity: 31.6,
      timestamp: '2026-01-01T09:57:00Z',
    },
  ],
  'pump-03': [
    {
      type: 'health_event',
      pumpId: 'pump-03',
      trigger: 'heartbeat',
      madScore: 0.3,
      vibration: 2.4,
      bearingTemp: 48.1,
      motorCurrent: 12.1,
      rpm: 1450,
      timestamp: '2026-01-01T09:50:00Z',
    },
    {
      type: 'integrity_event',
      pumpId: 'pump-03',
      state: 'LEAK_OK',
      sealLeak: 4.5,
      trendSlope: -0.02,
      turbidity: 2.1,
      timestamp: '2026-01-01T09:51:00Z',
    },
  ],
};

async function mockStableApi(page) {
  await page.route('**/pumps/*/insights', async (route) => {
    const url = new URL(route.request().url());
    const pumpId = url.pathname.split('/').filter(Boolean).slice(-2, -1)[0];
    const body = STABLE_INSIGHTS[pumpId] || [];
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(body) });
  });
}

test.describe('FlowForge dashboard — visual regression', () => {
  test('desktop full-page snapshot with populated data', async ({ page }) => {
    await mockStableApi(page);
    await page.goto('/');
    await expect(page.getByTestId('insight-log-table').locator('tbody tr')).toHaveCount(8);
    // Acquisition bar ticks a live clock — mask it so the snapshot stays deterministic.
    await expect(page).toHaveScreenshot('dashboard-desktop.png', {
      fullPage: true,
      mask: [page.getByTestId('acq-bar')],
    });
  });

  test('mobile full-page snapshot with populated data', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await mockStableApi(page);
    await page.goto('/');
    await expect(page.getByTestId('insight-log-table').locator('tbody tr')).toHaveCount(8);
    await expect(page).toHaveScreenshot('dashboard-mobile.png', {
      fullPage: true,
      mask: [page.getByTestId('acq-bar')],
    });
  });
});
