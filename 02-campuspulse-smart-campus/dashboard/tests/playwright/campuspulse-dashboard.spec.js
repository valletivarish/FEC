import { test, expect } from '@playwright/test';

// Fixture data mirrors the shared contract shapes exactly, so views parse it unmodified.
const STATUS_FIXTURE = {
  temperature: 22, humidity: 45, lightLux: 400, co2: 650,
};

const ALERTS_FIXTURE = {
  alerts: [
    { zoneId: 'A101', eventType: 'LEAK_SUSPECTED', severity: 'WARN', payload: {}, timestamp: '2026-07-01T08:00:00Z' },
    { zoneId: 'B202', eventType: 'AFTER_HOURS_SECURITY_EVENT', severity: 'BREACH', payload: {}, timestamp: '2026-07-01T23:15:00Z' },
  ],
};

const HISTORY_FIXTURE = {
  readings: [
    { zoneId: 'A101', topic: 'electricity', value: 4.2, timestamp: '2026-07-01T08:00:00Z' },
    { zoneId: 'A101', topic: 'electricity', value: 5.1, timestamp: '2026-07-01T08:05:00Z' },
  ],
  events: [],
};

// zoneHistoryHandler.js's alerts query is not topic-filtered, so electricity and water-flow
// requests both get every persisted event back - mirrors the real handler response shape.
const ELECTRICITY_HISTORY_FIXTURE = {
  readings: [
    { zoneId: 'A101', topic: 'electricity', value: 42.1, timestamp: '2026-07-01T08:05:00Z' },
  ],
  events: [
    { zoneId: 'A101', eventType: 'LOAD_ANOMALY', severity: 'BREACH', timestamp: '2026-07-01T08:05:00Z' },
  ],
};

const WATER_HISTORY_FIXTURE = {
  readings: [
    { zoneId: 'A101', topic: 'water-flow', value: 3.4, timestamp: '2026-07-01T08:05:00Z' },
  ],
  events: [
    { zoneId: 'A101', eventType: 'LEAK_SUSPECTED', severity: 'BREACH', timestamp: '2026-07-01T08:05:00Z' },
  ],
};

// hvac-duct-pressure is a plain reading in CampusPulseReadings, retrieved via its own
// topic-filtered query - mirrors what zoneHistoryHandler.js actually returns, not a fog event.
const DUCT_PRESSURE_HISTORY_FIXTURE = {
  readings: [
    { zoneId: 'A101', topic: 'hvac-duct-pressure', value: 187.3, timestamp: '2026-07-01T08:05:00Z' },
  ],
  events: [],
};

const DOOR_HISTORY_FIXTURE = {
  readings: [
    { zoneId: 'A101', topic: 'door-contact', value: 0, timestamp: '2026-07-01T23:00:00Z' },
  ],
  events: [
    { zoneId: 'A101', eventType: 'AFTER_HOURS_SECURITY_EVENT', severity: 'BREACH', timestamp: '2026-07-01T23:00:05Z' },
  ],
};

async function mockApi(page) {
  await page.route('**/zones/*/status', (route) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(STATUS_FIXTURE) })
  );
  await page.route('**/zones/*/history*', (route) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(HISTORY_FIXTURE) })
  );
  // Registered after the generic history route so Playwright's last-match-wins order
  // gives these more specific topic filters priority.
  await page.route('**/zones/*/history?topic=hvac-duct-pressure', (route) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(DUCT_PRESSURE_HISTORY_FIXTURE) })
  );
  await page.route('**/zones/*/history?topic=electricity', (route) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(ELECTRICITY_HISTORY_FIXTURE) })
  );
  await page.route('**/zones/*/history?topic=water-flow', (route) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(WATER_HISTORY_FIXTURE) })
  );
  await page.route('**/zones/*/history?topic=door-contact', (route) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(DOOR_HISTORY_FIXTURE) })
  );
  await page.route('**/alerts/active', (route) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(ALERTS_FIXTURE) })
  );
}

test.describe('zone grid', () => {
  test('renders a row per zone from the mocked API', async ({ page }) => {
    await mockApi(page);
    await page.goto('/');
    const rows = page.locator('#zone-grid tr');
    await expect(rows).toHaveCount(10);
    await expect(rows.filter({ hasText: 'A101' })).toBeVisible();
  });

  test('clicking a zone row reveals the detail panels and unlocks sidebar sections', async ({ page }) => {
    await mockApi(page);
    await page.goto('/');

    // Comfort/Energy/Security sidebar links are disabled until a zone is selected.
    await expect(page.locator('.sidebar-link[data-view="comfort"]')).toBeDisabled();
    await expect(page.locator('.sidebar-link[data-view="energy"]')).toBeDisabled();
    await expect(page.locator('.sidebar-link[data-view="security"]')).toBeDisabled();

    await page.locator('#zone-grid tr[data-zone-id="A101"] .zone-row-btn').click();

    const detail = page.locator('#zone-detail');
    await expect(detail).toBeVisible();
    await expect(page.locator('#energy-panel')).toContainText('Energy / A101');
    await expect(page.locator('#comfort-panel')).toContainText('Comfort / A101');
    await expect(page.locator('#security-panel')).toContainText('Security Timeline / A101');

    await expect(page.locator('.sidebar-link[data-view="comfort"]')).toBeEnabled();
    await expect(page.locator('.sidebar-link[data-view="energy"]')).toBeEnabled();
    await expect(page.locator('.sidebar-link[data-view="security"]')).toBeEnabled();
    await expect(page.locator('.sidebar-link[data-view="comfort"]')).toHaveClass(/sidebar-link-active/);
  });

  test('energy panel renders the hvac-duct-pressure corroborating reading', async ({ page }) => {
    await mockApi(page);
    await page.goto('/');
    await page.locator('#zone-grid tr[data-zone-id="A101"] .zone-row-btn').click();

    const ductRow = page.locator('#energy-readings tr', { hasText: 'HVAC Duct Pressure' });
    await expect(ductRow).toBeVisible();
    await expect(ductRow.locator('td.num').first()).toHaveText('187.3 Pa');
    await expect(ductRow.locator('.badge')).toHaveText('CORROBORATING');
  });

  test('energy panel shows the real LOAD_ANOMALY badge for electricity, not a NONE placeholder', async ({ page }) => {
    await mockApi(page);
    await page.goto('/');
    await page.locator('#zone-grid tr[data-zone-id="A101"] .zone-row-btn').click();

    const electricityRow = page.locator('#energy-readings tr', { hasText: 'Electricity' });
    await expect(electricityRow.locator('.badge')).toHaveText('LOAD_ANOMALY');
    await expect(electricityRow.locator('.badge')).toHaveClass(/text-bg-danger/);
    await expect(electricityRow.locator('.badge')).not.toHaveText('NONE');
  });

  test('energy panel shows the real LEAK_SUSPECTED badge for water flow, not a NONE placeholder', async ({ page }) => {
    await mockApi(page);
    await page.goto('/');
    await page.locator('#zone-grid tr[data-zone-id="A101"] .zone-row-btn').click();

    const waterRow = page.locator('#energy-readings tr', { hasText: 'Water Flow' });
    await expect(waterRow.locator('.badge')).toHaveText('LEAK_SUSPECTED');
    await expect(waterRow.locator('.badge')).toHaveClass(/text-bg-danger/);
    await expect(waterRow.locator('.badge')).not.toHaveText('NONE');
  });
});

test.describe('security timeline', () => {
  test('renders a genuine security event row, not an empty panel', async ({ page }) => {
    await mockApi(page);
    await page.goto('/');
    await page.locator('#zone-grid tr[data-zone-id="A101"] .zone-row-btn').click();

    const timeline = page.locator('#security-timeline');
    await expect(timeline.locator('tr')).not.toHaveText(['No state transitions recorded.']);

    const eventRow = timeline.locator('tr', { hasText: 'AFTER_HOURS_SECURITY_EVENT' });
    await expect(eventRow).toBeVisible();
    await expect(eventRow.locator('.badge')).toHaveText('BREACH');
    await expect(eventRow.locator('.badge')).toHaveClass(/text-bg-danger/);
  });
});

test.describe('alert feed', () => {
  test('lists active alerts with a clickable acknowledge button', async ({ page }) => {
    await mockApi(page);
    await page.goto('/');
    await page.locator('.sidebar-link[data-view="alerts"]').click();

    const rows = page.locator('#alert-feed-list tr.alert-row');
    await expect(rows).toHaveCount(2);

    await expect(rows.first().locator('.badge')).toHaveText('WARN');
    await expect(rows.last().locator('.badge')).toHaveText('BREACH');

    const firstAckBtn = rows.first().locator('.alert-ack-btn');
    await firstAckBtn.click();
    await expect(firstAckBtn).toHaveText('Acknowledged');
    await expect(rows.first()).toHaveClass(/alert-acknowledged/);
  });
});

test.describe('responsive layout', () => {
  test('zone table collapses to a horizontally scrollable single column at mobile width', async ({ page }) => {
    await mockApi(page);
    await page.setViewportSize({ width: 375, height: 812 });
    await page.goto('/');

    const scrollWrapper = page.locator('.zone-grid-panel .table-responsive');
    const overflowX = await scrollWrapper.evaluate((el) => getComputedStyle(el).overflowX);
    expect(overflowX).toBe('auto');

    const table = page.locator('.zone-grid-panel table');
    const tableBox = await table.boundingBox();
    const wrapperBox = await scrollWrapper.boundingBox();
    expect(tableBox.width).toBeGreaterThan(wrapperBox.width - 1);
  });

  test('sidebar stays a fixed-width column beside the reflowed main content at mobile width', async ({ page }) => {
    await mockApi(page);
    await page.setViewportSize({ width: 375, height: 812 });
    await page.goto('/');

    const sidebar = page.locator('.app-sidebar');
    await expect(sidebar).toBeVisible();
    const sidebarBox = await sidebar.boundingBox();
    const shellBox = await page.locator('.app-shell').boundingBox();

    // The sidebar keeps its own fixed width (doesn't stack above content) and the
    // main content area occupies the remaining horizontal space beside it.
    expect(sidebarBox.width).toBeLessThan(250);
    expect(sidebarBox.width).toBeGreaterThan(150);
    const main = page.locator('.app-main');
    const mainBox = await main.boundingBox();
    expect(mainBox.x).toBeGreaterThanOrEqual(sidebarBox.x + sidebarBox.width - 1);
    expect(sidebarBox.height).toBeGreaterThanOrEqual(shellBox.height - 1);
  });
});
