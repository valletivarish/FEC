import { test, expect } from '@playwright/test';
import { mockCareWatchApi } from './fixtures.js';

test.describe('CareWatch Console — visual regression', () => {
  test('desktop full-page screenshot with populated data', async ({ page }) => {
    await mockCareWatchApi(page);
    await page.goto('/');
    await expect(page.locator('[data-testid="resident-roster-item"]')).toHaveCount(3);
    await expect(page.locator('[data-testid="fall-incident-item"]')).toHaveCount(1);

    await expect(page).toHaveScreenshot('carewatch-desktop.png', { fullPage: true });
  });

  test('mobile full-page screenshot with populated data', async ({ page }) => {
    await mockCareWatchApi(page);
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto('/');
    await expect(page.locator('[data-testid="resident-roster-item"]')).toHaveCount(3);
    await expect(page.locator('[data-testid="fall-incident-item"]')).toHaveCount(1);

    await expect(page).toHaveScreenshot('carewatch-mobile.png', { fullPage: true });
  });
});
