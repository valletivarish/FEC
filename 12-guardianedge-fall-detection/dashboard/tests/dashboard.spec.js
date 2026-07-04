import { test, expect } from '@playwright/test';
import { mockCareWatchApi, residentsFixture } from './fixtures.js';

test.describe('CareWatch Console — functional', () => {
  test('renders one large list-group-item per resident with correct risk pill classes', async ({ page }) => {
    await mockCareWatchApi(page);
    await page.goto('/');

    const rosterItems = page.locator('[data-testid="resident-roster-item"]');
    await expect(rosterItems).toHaveCount(3);

    await expect(rosterItems.nth(0).locator('[data-testid="risk-pill"]')).toHaveClass(/text-bg-success/);
    await expect(rosterItems.nth(0).locator('[data-testid="risk-pill"]')).toHaveText('NORMAL');

    await expect(rosterItems.nth(1).locator('[data-testid="risk-pill"]')).toHaveClass(/text-bg-warning/);
    await expect(rosterItems.nth(1).locator('[data-testid="risk-pill"]')).toHaveText('WARNING');

    await expect(rosterItems.nth(2).locator('[data-testid="risk-pill"]')).toHaveClass(/risk-critical/);
    await expect(rosterItems.nth(2).locator('[data-testid="risk-pill"]')).toHaveText('CRITICAL');

    for (const resident of residentsFixture) {
      await expect(page.locator(`[data-resident-id="${resident.residentId}"]`).first()).toContainText(
        resident.residentName
      );
    }
  });

  test('renders SDNN values and an svg sparkline per resident in the vitals timeline', async ({ page }) => {
    await mockCareWatchApi(page);
    await page.goto('/');

    const vitalsItems = page.locator('[data-testid="vitals-timeline-item"]');
    await expect(vitalsItems).toHaveCount(3);

    await expect(vitalsItems.first().locator('[data-testid="sdnn-value"]')).toContainText('ms');
    await expect(vitalsItems.first().locator('svg.hrv-sparkline')).toBeVisible();
    await expect(vitalsItems.first().locator('svg.hrv-sparkline polyline')).toHaveCount(1);
  });

  test('fall incident panel renders entries and Acknowledge removes the item after POST resolves', async ({ page }) => {
    await mockCareWatchApi(page);
    await page.goto('/');

    const fallItems = page.locator('[data-testid="fall-incident-item"]');
    await expect(fallItems).toHaveCount(1);
    await expect(fallItems.first()).toContainText('Beatrice Adeyemi');

    const ackButton = fallItems.first().locator('[data-testid="acknowledge-button"]');
    await ackButton.click();

    await expect(page.locator('[data-testid="acknowledge-button"]')).toHaveCount(0);
    await expect(page.locator('[data-testid="fall-incident-item"][data-acknowledged="true"]')).toHaveCount(1);
  });

  test('room presence panel renders mocked entries for every resident', async ({ page }) => {
    await mockCareWatchApi(page);
    await page.goto('/');

    const roomItems = page.locator('[data-testid="room-presence-item"]');
    await expect(roomItems).toHaveCount(3);
    await expect(roomItems.first()).toContainText('Margaret Hale');
  });

  test('panels stack responsively at mobile width', async ({ page }) => {
    await mockCareWatchApi(page);
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto('/');

    const roster = page.locator('[data-testid="resident-roster-panel"]');
    const vitals = page.locator('[data-testid="vitals-timeline-panel"]');
    await expect(roster).toBeVisible();
    await expect(vitals).toBeVisible();

    const rosterBox = await roster.boundingBox();
    const vitalsBox = await vitals.boundingBox();
    expect(vitalsBox.y).toBeGreaterThan(rosterBox.y);
  });

  test('renders the full UI shell with an explanatory empty state when there is no live backend', async ({ page }) => {
    await page.route('**/residents', async (route) => {
      await route.fulfill({ status: 500, contentType: 'application/json', body: JSON.stringify({}) });
    });
    await page.goto('/');

    await expect(page.locator('.app-sidebar')).toBeVisible();
    await expect(page.locator('.app-sidebar')).toContainText('CareWatch');
    await expect(page.locator('[data-testid="resident-roster-empty"]')).toBeVisible();
    await expect(page.locator('[data-testid="vitals-timeline-empty"]')).toBeVisible();
    await expect(page.locator('[data-testid="fall-incident-empty"]')).toBeVisible();
    await expect(page.locator('[data-testid="room-presence-empty"]')).toBeVisible();
  });
});
