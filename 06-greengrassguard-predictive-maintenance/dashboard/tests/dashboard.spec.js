import { test, expect } from '@playwright/test';

const ASSET_IDS = ['asset-01', 'asset-02', 'asset-03', 'asset-04'];

// per-asset event fixtures keyed by the asset id embedded in the mocked route
const EVENTS_BY_ASSET = {
  'asset-01': [
    {
      type: 'vibe_fault',
      asset_id: 'asset-01',
      metric: 'vibe-axial',
      fault_bands: [
        { band: 'mid', energy: 12.345, anomaly_score: 4.1 },
        { band: 'high', energy: 8.2, anomaly_score: 3.9 },
        { band: 'low', energy: 2.1, anomaly_score: 1.2 },
      ],
      timestamp: '2026-07-02T10:15:00Z',
    },
  ],
  'asset-02': [
    {
      type: 'thermal_event',
      asset_id: 'asset-02',
      verdict_tags: ['runaway', 'sideband'],
      slope: 0.71,
      deviation: 9.4,
      timestamp: '2026-07-02T10:16:00Z',
    },
  ],
  'asset-03': [
    {
      type: 'hydraulic_event',
      asset_id: 'asset-03',
      efficiency: 0.42,
      cavitation_suspected: true,
      flow_cv: 0.21,
      pressure: 6.5,
      timestamp: '2026-07-02T10:17:00Z',
    },
  ],
  'asset-04': [],
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

test.describe('GreengrassGuard dashboard — functional', () => {
  test('asset grid renders one row per asset', async ({ page }) => {
    await mockGuardApi(page);
    await page.goto('/');

    const rows = page.getByTestId('asset-row');
    await expect(rows).toHaveCount(4);
    for (const assetId of ASSET_IDS) {
      await expect(page.locator(`[data-testid="asset-row"][data-asset-id="${assetId}"]`)).toBeVisible();
    }
  });

  test('vibe fault detail shows fault_bands for the most recent fault', async ({ page }) => {
    await mockGuardApi(page);
    await page.goto('/');

    const card = page.getByTestId('vibe-fault-card');
    await expect(card).toContainText('asset-01');

    const bandRows = page.getByTestId('fault-band-row');
    await expect(bandRows).toHaveCount(3);
    await expect(bandRows.first()).toContainText('mid');
    await expect(bandRows.first()).toContainText('12.345');
  });

  test('thermal events table renders mocked entries with correct badges', async ({ page }) => {
    await mockGuardApi(page);
    await page.goto('/');

    const row = page.getByTestId('thermal-event-row');
    await expect(row).toHaveCount(1);
    await expect(row).toContainText('asset-02');
    await expect(row.locator('.badge.text-bg-danger')).toContainText('runaway');
    await expect(row.locator('.badge.text-bg-warning')).toContainText('sideband');
  });

  test('hydraulic events table renders mocked entries with correct badges', async ({ page }) => {
    await mockGuardApi(page);
    await page.goto('/');

    const row = page.getByTestId('hydraulic-event-row');
    await expect(row).toHaveCount(1);
    await expect(row).toContainText('asset-03');
    await expect(row.locator('.badge.text-bg-danger')).toContainText('Suspected');
  });

  test('fault ticker lists all diagnosis events as a list-group, most recent first', async ({ page }) => {
    await mockGuardApi(page);
    await page.goto('/');

    const list = page.getByTestId('fault-ticker-list');
    await expect(list).toBeVisible();

    const items = page.getByTestId('ticker-item');
    await expect(items).toHaveCount(3);
    await expect(items.first()).toContainText('asset-03');

    // each item is a list-group-item, not a table row — confirms the log/ticker archetype
    await expect(items.first()).toHaveClass(/list-group-item/);
  });

  test('asset grid health indicator uses a colored progress bar per severity', async ({ page }) => {
    await mockGuardApi(page);
    await page.goto('/');

    const faultRow = page.locator('[data-testid="asset-row"][data-asset-id="asset-01"]');
    await expect(faultRow).toHaveAttribute('data-status', 'fault');
    const faultBar = faultRow.locator('[data-testid="asset-health-progress"] .progress-bar');
    await expect(faultBar).toHaveClass(/bg-danger/);

    const nominalRow = page.locator('[data-testid="asset-row"][data-asset-id="asset-04"]');
    await expect(nominalRow).toHaveAttribute('data-status', 'nominal');
    const nominalBar = nominalRow.locator('[data-testid="asset-health-progress"] .progress-bar');
    await expect(nominalBar).toHaveClass(/bg-success/);
  });

  test('responsive layout stacks at mobile width', async ({ page }) => {
    await mockGuardApi(page);
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto('/');

    const thermalSection = page.locator('[aria-label="Thermal events"]');
    const hydraulicSection = page.locator('[aria-label="Hydraulic events"]');
    const thermalBox = await thermalSection.boundingBox();
    const hydraulicBox = await hydraulicSection.boundingBox();

    expect(thermalBox).not.toBeNull();
    expect(hydraulicBox).not.toBeNull();
    expect(hydraulicBox.y).toBeGreaterThanOrEqual(thermalBox.y + thermalBox.height - 1);
  });

  test('acoustic advisory and severity-escalated vibe fault render with distinct treatment', async ({ page }) => {
    await page.route('**/assets/*/diagnoses', async (route) => {
      const url = route.request().url();
      let events = [];
      if (url.includes('asset-01')) {
        events = [
          {
            type: 'vibe_fault',
            asset_id: 'asset-01',
            metric: 'vibe-axial',
            fault_bands: [{ band: 'mid', energy: 12.345, anomaly_score: 4.1 }],
            timestamp: '2026-07-02T10:15:00Z',
            severity: 'high',
            acoustic_corroborated: true,
          },
        ];
      } else if (url.includes('asset-02')) {
        events = [
          {
            type: 'acoustic_advisory',
            asset_id: 'asset-02',
            db_level: 78.4,
            timestamp: '2026-07-02T10:16:00Z',
          },
        ];
      }
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ events }) });
    });
    await page.goto('/');

    // vibe fault detail card shows the HIGH severity badge and the corroboration note
    const card = page.getByTestId('vibe-fault-card');
    await expect(card).toContainText('asset-01');
    const severityBadge = page.getByTestId('vibe-fault-severity');
    await expect(severityBadge).toHaveText('HIGH');
    await expect(severityBadge).toHaveClass(/text-bg-danger/);
    await expect(page.getByTestId('acoustic-corroborated-note')).toContainText('Acoustic-corroborated');

    // ticker shows the advisory row with asset id, dB level, and a distinct ADVISORY badge
    const advisoryRow = page.locator('[data-testid="ticker-item"][data-event-type="acoustic_advisory"]');
    await expect(advisoryRow).toContainText('asset-02');
    await expect(advisoryRow).toContainText('78.4 dB');
    const advisoryBadge = advisoryRow.locator('.badge');
    await expect(advisoryBadge).toHaveText('Advisory');
    await expect(advisoryBadge).toHaveClass(/text-bg-light/);

    // ticker's vibe_fault row is untouched by the advisory's muted styling — still the danger tint
    const vibeFaultRow = page.locator('[data-testid="ticker-item"][data-event-type="vibe_fault"]');
    await expect(vibeFaultRow).toContainText('asset-01');
    await expect(vibeFaultRow).toContainText('acoustic-corroborated');
    await expect(vibeFaultRow).toHaveClass(/list-group-item-danger/);
  });

  test('no-backend empty state renders explanatory message', async ({ page }) => {
    await page.route('**/assets/*/diagnoses', async (route) => {
      await route.fulfill({ status: 500, contentType: 'application/json', body: '{}' });
    });
    await page.goto('/');

    const banner = page.getByTestId('empty-state-banner');
    await expect(banner).toBeVisible();
    await expect(banner).toContainText('No live data — start the local stack to see readings');

    await expect(page.getByTestId('navbar')).toBeVisible();
    await expect(page.getByTestId('asset-grid-table')).toBeVisible();
  });
});
