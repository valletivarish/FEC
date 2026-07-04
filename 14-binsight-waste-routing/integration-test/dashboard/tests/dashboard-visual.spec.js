import { test, expect } from '@playwright/test';
import { POPULATED_FLEET_SUMMARY } from './fixtures.js';

async function mockFleetSummary(page) {
  await page.route('**/fleet/summary', (route) => {
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(POPULATED_FLEET_SUMMARY),
    });
  });
}

test.describe('HarborPulse dashboard — visual regression', () => {
  test('desktop full-page snapshot with populated data', async ({ page }) => {
    await mockFleetSummary(page);
    await page.setViewportSize({ width: 1280, height: 800 });
    await page.goto('/');
    await page.waitForSelector('#safety-alarms-tbody tr');

    await expect(page).toHaveScreenshot('harborpulse-desktop.png', {
      fullPage: true,
      maxDiffPixelRatio: 0.02,
    });
  });

  test('mobile full-page snapshot with populated data', async ({ page }) => {
    await mockFleetSummary(page);
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto('/');
    await page.waitForSelector('#safety-alarms-tbody tr');

    await expect(page).toHaveScreenshot('harborpulse-mobile.png', {
      fullPage: true,
      maxDiffPixelRatio: 0.02,
    });
  });
});
