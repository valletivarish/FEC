import { test, expect } from '@playwright/test';
import { POPULATED_FLEET_SUMMARY, EMPTY_FLEET_SUMMARY } from './fixtures.js';

async function mockFleetSummary(page, payload) {
  await page.route('**/fleet/summary', (route) => {
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(payload),
    });
  });
}

test.describe('HarborPulse dashboard — functional', () => {
  test('renders radar canvas with correct id and dimensions', async ({ page }) => {
    await mockFleetSummary(page, POPULATED_FLEET_SUMMARY);
    await page.goto('/');
    await page.waitForSelector('#fleet-radar-legend .legend-row');

    const canvas = page.locator('#fleet-radar-canvas');
    await expect(canvas).toHaveAttribute('width', '360');
    await expect(canvas).toHaveAttribute('height', '360');
  });

  test('legend shows all 3 vessel ids', async ({ page }) => {
    await mockFleetSummary(page, POPULATED_FLEET_SUMMARY);
    await page.goto('/');
    await page.waitForSelector('#fleet-radar-legend .legend-row');

    const legendText = await page.locator('#fleet-radar-legend').innerText();
    expect(legendText).toContain('vessel-01');
    expect(legendText).toContain('vessel-02');
    expect(legendText).toContain('vessel-03');
  });

  test('engine health table renders rows with correct degraded-bearing pill states', async ({ page }) => {
    await mockFleetSummary(page, POPULATED_FLEET_SUMMARY);
    await page.goto('/');
    await page.waitForSelector('#engine-health-tbody tr');

    const rows = page.locator('#engine-health-tbody tr');
    await expect(rows).toHaveCount(3);

    const vessel01Row = page.locator('#engine-health-tbody tr', { hasText: 'vessel-01' });
    await expect(vessel01Row.locator('.badge')).toHaveText('DEGRADED');
    await expect(vessel01Row.locator('.badge')).toHaveClass(/text-bg-danger/);

    const vessel02Row = page.locator('#engine-health-tbody tr', { hasText: 'vessel-02' });
    await expect(vessel02Row.locator('.badge')).toHaveText('NOMINAL');
    await expect(vessel02Row.locator('.badge')).toHaveClass(/text-bg-success/);
  });

  test('sea state table renders rows with correct class-color pill badges', async ({ page }) => {
    await mockFleetSummary(page, POPULATED_FLEET_SUMMARY);
    await page.goto('/');
    await page.waitForSelector('#sea-state-tbody tr');

    const rows = page.locator('#sea-state-tbody tr');
    await expect(rows).toHaveCount(3);

    const roughRow = page.locator('#sea-state-tbody tr', { hasText: 'vessel-01' });
    await expect(roughRow.locator('.badge')).toHaveText('ROUGH');
    await expect(roughRow.locator('.badge')).toHaveClass(/text-bg-danger/);

    const calmRow = page.locator('#sea-state-tbody tr', { hasText: 'vessel-02' });
    await expect(calmRow.locator('.badge')).toHaveText('CALM');
    await expect(calmRow.locator('.badge')).toHaveClass(/text-bg-success/);

    const moderateRow = page.locator('#sea-state-tbody tr', { hasText: 'vessel-03' });
    await expect(moderateRow.locator('.badge')).toHaveText('MODERATE');
    await expect(moderateRow.locator('.badge')).toHaveClass(/text-bg-warning/);
  });

  test('safety/alarms table renders rows with correct active/resolved pill states', async ({ page }) => {
    await mockFleetSummary(page, POPULATED_FLEET_SUMMARY);
    await page.goto('/');
    await page.waitForSelector('#safety-alarms-tbody tr');

    const rows = page.locator('#safety-alarms-tbody tr');
    await expect(rows).toHaveCount(3);

    const activeRow = page.locator('#safety-alarms-tbody tr', { hasText: 'vessel-01' });
    await expect(activeRow.locator('.badge')).toHaveText('ACTIVE');
    await expect(activeRow.locator('.badge')).toHaveClass(/text-bg-danger/);

    const resolvedRow = page.locator('#safety-alarms-tbody tr', { hasText: 'vessel-02' });
    await expect(resolvedRow.locator('.badge')).toHaveText('RESOLVED');
    await expect(resolvedRow.locator('.badge')).toHaveClass(/text-bg-secondary/);
  });

  test('safety/alarms table is sorted chronologically most-recent-first', async ({ page }) => {
    await mockFleetSummary(page, POPULATED_FLEET_SUMMARY);
    await page.goto('/');
    await page.waitForSelector('#safety-alarms-tbody tr');

    const firstRowText = await page.locator('#safety-alarms-tbody tr').first().innerText();
    expect(firstRowText).toContain('vessel-01');
  });

  test('responsive stacking at mobile width', async ({ page }) => {
    await mockFleetSummary(page, POPULATED_FLEET_SUMMARY);
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto('/');
    await page.waitForSelector('#engine-health-tbody tr');

    const canvasBox = await page.locator('#fleet-radar-canvas').boundingBox();
    const engineTableBox = await page.locator('#engine-health-tbody').boundingBox();

    expect(canvasBox).not.toBeNull();
    expect(engineTableBox).not.toBeNull();
    expect(engineTableBox.y).toBeGreaterThan(canvasBox.y);
  });

  test('no-backend empty state renders full shell with explanatory message', async ({ page }) => {
    await page.route('**/fleet/summary', (route) => {
      route.fulfill({ status: 500, contentType: 'application/json', body: '{}' });
    });
    await page.goto('/');
    await page.waitForSelector('#fleet-empty-note:not(.d-none)');

    await expect(page.locator('.navbar-brand')).toContainText('HarborPulse');
    await expect(page.locator('#fleet-radar-canvas')).toBeVisible();
    const note = page.locator('#fleet-empty-note');
    await expect(note).toBeVisible();
    await expect(note).not.toHaveText('');

    await expect(page.locator('h2.section-header')).toHaveCount(4);
  });

  test('empty fleet summary (zero vessels) still renders empty-state shell', async ({ page }) => {
    await mockFleetSummary(page, EMPTY_FLEET_SUMMARY);
    await page.goto('/');
    await page.waitForSelector('#fleet-empty-note:not(.d-none)');

    await expect(page.locator('#fleet-empty-note')).toBeVisible();
    await expect(page.locator('#engine-health-tbody')).toContainText('No engine health data available.');
  });
});
