import { test, expect } from '@playwright/test';
import { mockGreenGridApi } from './fixtures.js';

test.describe('GreenGrid dashboard — visual regression', () => {
  test('desktop full page — populated data', async ({ page }) => {
    await mockGreenGridApi(page);
    await page.goto('/');
    await page.setViewportSize({ width: 1280, height: 800 });
    await page.waitForSelector('#station-overview-grid .station-field-report');

    await expect(page).toHaveScreenshot('dashboard-desktop.png', { fullPage: true });
  });

  test('mobile full page — populated data', async ({ page }) => {
    await mockGreenGridApi(page);
    await page.goto('/');
    await page.setViewportSize({ width: 390, height: 844 });
    await page.waitForSelector('#station-overview-grid .station-field-report');

    await expect(page).toHaveScreenshot('dashboard-mobile.png', { fullPage: true });
  });
});
