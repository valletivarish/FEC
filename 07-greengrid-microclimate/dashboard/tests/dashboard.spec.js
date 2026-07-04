import { test, expect } from '@playwright/test';
import { mockGreenGridApi, mockGreenGridApiEmpty } from './fixtures.js';

test.describe('GreenGrid dashboard — functional', () => {
  test('renders a station field-report card per station', async ({ page }) => {
    await mockGreenGridApi(page);
    await page.goto('/');

    const cards = page.locator('#station-overview-grid .station-field-report');
    await expect(cards).toHaveCount(3);
    await expect(page.locator('.station-field-report[data-station-id="station-quad"]')).toHaveCount(1);
    await expect(page.locator('.station-field-report[data-station-id="station-north-lawn"]')).toHaveCount(1);
    await expect(page.locator('.station-field-report[data-station-id="station-arboretum"]')).toHaveCount(1);

    // Each card is a compact field report: header (name + status badge) plus a
    // 2-column list-group of current conditions — not a table row.
    const quadCard = page.locator('.station-field-report[data-station-id="station-quad"]');
    await expect(quadCard.locator('.card-header')).toContainText('Quad');
    await expect(quadCard.locator('.card-header .badge')).toBeVisible();
    await expect(quadCard.locator('.list-group-item')).toHaveCount(3);
    await expect(quadCard.locator('.list-group-item').nth(0)).toContainText('Air Temp');
    await expect(quadCard.locator('.list-group-item').nth(1)).toContainText('Wind');
    await expect(quadCard.locator('.list-group-item').nth(2)).toContainText('Pressure Trend');
  });

  test('summary KPI row shows aggregates computed from the real event stream', async ({ page }) => {
    await mockGreenGridApi(page);
    await page.goto('/');

    const kpiRow = page.locator('#summary-kpi-row .kpi-row');
    await expect(kpiRow).toBeVisible();

    // Values are folded from the six mocked events across the three stations.
    await expect(page.locator('[data-kpi="stations"]')).toHaveText('3');
    await expect(page.locator('[data-kpi="events"]')).toHaveText('6');
    await expect(page.locator('[data-kpi="storm-watches"]')).toHaveText('1');
    await expect(page.locator('[data-kpi="soil-risks"]')).toHaveText('3');
    await expect(page.locator('[data-kpi="pollution-exceedances"]')).toHaveText('1');
  });

  test('summary KPI row reports zeroed events but the real station count when the backend is empty', async ({ page }) => {
    await mockGreenGridApiEmpty(page);
    await page.goto('/');

    await expect(page.locator('[data-kpi="stations"]')).toHaveText('3');
    await expect(page.locator('[data-kpi="events"]')).toHaveText('0');
    await expect(page.locator('[data-kpi="storm-watches"]')).toHaveText('0');
    await expect(page.locator('[data-kpi="soil-risks"]')).toHaveText('0');
    await expect(page.locator('[data-kpi="pollution-exceedances"]')).toHaveText('0');
  });

  test('weather watch card shows storm risk score components', async ({ page }) => {
    await mockGreenGridApi(page);
    await page.goto('/');

    const card = page.locator('#weather-watch-card');
    await expect(card).toContainText('station-quad');
    await expect(card).toContainText('78.5');
    await expect(card).toContainText('Mean wind speed: 14.2 m/s');
    await expect(card).toContainText('Mean wind direction: 210');
    await expect(card).toContainText('Barometric slope: -1.80 hPa/sample');
    await expect(card).toContainText('UV index: 2.3');
  });

  test('soil risks table renders mocked entries with correct badges', async ({ page }) => {
    await mockGreenGridApi(page);
    await page.goto('/');

    const rows = page.locator('#soil-risks-body tr');
    await expect(rows).toHaveCount(3);

    const frostRow = rows.filter({ hasText: 'station-north-lawn' });
    await expect(frostRow.locator('.badge.text-bg-danger')).toContainText('frost warning');

    const irrigationRow = rows.filter({ hasText: 'station-quad' });
    await expect(irrigationRow.locator('.badge.text-bg-warning')).toContainText('irrigation need');

    const diseaseRow = rows.filter({ hasText: 'station-arboretum' });
    await expect(diseaseRow.locator('.badge.text-bg-danger')).toContainText('disease risk');
  });

  test('pollution watch table renders mocked entries with correct badges', async ({ page }) => {
    await mockGreenGridApi(page);
    await page.goto('/');

    const rows = page.locator('#pollution-watch-body tr');
    await expect(rows).toHaveCount(2);

    const exceedingRow = rows.filter({ hasText: 'pm2-5' });
    await expect(exceedingRow.locator('.badge.text-bg-danger')).toContainText('exceedance watch');

    const withinRangeRow = rows.filter({ hasText: 'ambient-noise' });
    await expect(withinRangeRow.locator('.badge.text-bg-success')).toContainText('within range');
  });

  test('event log lists events chronologically, most recent first', async ({ page }) => {
    await mockGreenGridApi(page);
    await page.goto('/');

    const rows = page.locator('#event-log-body tr');
    await expect(rows).toHaveCount(6);
    await expect(rows.first()).toContainText('station-quad');
    await expect(rows.first()).toContainText('2026-07-01T12:00:00Z');
  });

  test('sidebar stays a fixed-width column beside the content at mobile width', async ({ page }) => {
    await mockGreenGridApi(page);
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto('/');

    const sidebar = page.locator('.app-sidebar');
    await expect(sidebar).toBeVisible();
    await expect(page.locator('.sidebar-brand .brand-name')).toContainText('GreenGrid');

    const sidebarBox = await sidebar.boundingBox();
    const mainBox = await page.locator('.app-main').boundingBox();
    // The sidebar keeps its own fixed width and the main content sits beside it.
    expect(sidebarBox.width).toBeLessThan(250);
    expect(mainBox.x).toBeGreaterThanOrEqual(sidebarBox.x + sidebarBox.width - 1);
  });

  test('station card-grid reflows from three columns to one column at mobile width', async ({ page }) => {
    await mockGreenGridApi(page);
    await page.goto('/');

    await page.setViewportSize({ width: 1280, height: 800 });
    const firstCardDesktop = page.locator('#station-overview-grid .col').first().boundingBox();
    const secondCardDesktop = page.locator('#station-overview-grid .col').nth(1).boundingBox();
    const [firstBoxDesktop, secondBoxDesktop] = await Promise.all([firstCardDesktop, secondCardDesktop]);
    // row-cols-lg-3 places cards side by side on the same row at desktop width.
    expect(Math.abs(firstBoxDesktop.y - secondBoxDesktop.y)).toBeLessThan(2);

    await page.setViewportSize({ width: 390, height: 844 });
    const firstCardMobile = page.locator('#station-overview-grid .col').first().boundingBox();
    const secondCardMobile = page.locator('#station-overview-grid .col').nth(1).boundingBox();
    const [firstBoxMobile, secondBoxMobile] = await Promise.all([firstCardMobile, secondCardMobile]);
    // row-cols-1 stacks cards into a single column below mobile breakpoint.
    expect(secondBoxMobile.y).toBeGreaterThan(firstBoxMobile.y + firstBoxMobile.height - 1);
  });

  test('renders the explanatory empty state when there is no live backend data', async ({ page }) => {
    await mockGreenGridApiEmpty(page);
    await page.goto('/');

    await expect(page.locator('#empty-state')).toBeVisible();
    await expect(page.locator('#empty-state')).toContainText('No live data — start the local stack to see readings');

    await expect(page.locator('.app-sidebar')).toBeVisible();
    await expect(page.locator('h2', { hasText: 'Station Overview' })).toBeVisible();
    await expect(page.locator('#station-overview-grid .station-field-report')).toHaveCount(3);
  });

  test('renders the empty state when the backend is unreachable', async ({ page }) => {
    await page.route('**/stations/*/events', (route) => route.abort('failed'));
    await page.goto('/');

    await expect(page.locator('#empty-state')).toBeVisible();
    await expect(page.locator('#empty-state')).toContainText('No live data — start the local stack to see readings');
  });
});
