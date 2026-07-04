import { test, expect } from '@playwright/test';

const ASSET_IDS = ['asset-01', 'asset-02', 'asset-03', 'asset-04'];

// fixed timestamps and values keep the screenshot deterministic across runs
const EVENTS_BY_ASSET = {
  'asset-01': [
    {
      type: 'vibe_fault',
      asset_id: 'asset-01',
      metric: 'vibe-axial',
      fault_bands: [
        { band: 'mid', energy: 15.5, anomaly_score: 4.4 },
        { band: 'high', energy: 9.1, anomaly_score: 3.8 },
        { band: 'low', energy: 3.2, anomaly_score: 1.1 },
      ],
      timestamp: '2026-07-02T09:00:00Z',
      severity: 'high',
      acoustic_corroborated: true,
    },
  ],
  'asset-02': [
    {
      type: 'thermal_event',
      asset_id: 'asset-02',
      verdict_tags: ['sideband'],
      slope: 0.31,
      deviation: 8.9,
      timestamp: '2026-07-02T09:05:00Z',
    },
    {
      type: 'acoustic_advisory',
      asset_id: 'asset-02',
      db_level: 76.2,
      timestamp: '2026-07-02T09:06:00Z',
    },
  ],
  'asset-03': [
    {
      type: 'hydraulic_event',
      asset_id: 'asset-03',
      efficiency: 0.65,
      cavitation_suspected: false,
      flow_cv: 0.08,
      pressure: 9.1,
      timestamp: '2026-07-02T09:10:00Z',
    },
  ],
  'asset-04': [
    {
      type: 'thermal_event',
      asset_id: 'asset-04',
      verdict_tags: ['runaway'],
      slope: 0.62,
      deviation: 3.1,
      timestamp: '2026-07-02T09:15:00Z',
    },
  ],
};

async function mockGuardApi(page) {
  await page.route('**/assets/*/diagnoses', async (route) => {
    const url = route.request().url();
    const match = ASSET_IDS.find((id) => url.includes(id));
    const events = match ? EVENTS_BY_ASSET[match] : [];
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ events }),
    });
  });
}

test.describe('GreengrassGuard dashboard — visual regression', () => {
  test('desktop full page snapshot with populated data', async ({ page }) => {
    await mockGuardApi(page);
    await page.goto('/');
    await expect(page.getByTestId('asset-row')).toHaveCount(4);
    await expect(page.getByTestId('vibe-fault-card')).toContainText('asset-01');

    await expect(page).toHaveScreenshot('dashboard-desktop.png', { fullPage: true });
  });

  test('mobile full page snapshot with populated data', async ({ page }) => {
    await mockGuardApi(page);
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto('/');
    await expect(page.getByTestId('asset-row')).toHaveCount(4);
    await expect(page.getByTestId('vibe-fault-card')).toContainText('asset-01');

    await expect(page).toHaveScreenshot('dashboard-mobile.png', { fullPage: true });
  });
});
