import { test, expect } from '@playwright/test';

const ALERTS_FIXTURE = {
  alerts: [
    { zoneId: 'B202', eventType: 'AFTER_HOURS_SECURITY_EVENT', severity: 'BREACH', payload: {}, timestamp: '2026-07-01T23:15:00Z' },
  ],
};

const STATUS_FIXTURE = { temperature: 21, humidity: 42, lightLux: 300, co2: 700 };
const HISTORY_FIXTURE = { readings: [], events: [] };

// Real LOAD_ANOMALY/AFTER_HOURS_SECURITY_EVENT shape, matching what zoneHistoryHandler.js's
// alerts-table query now actually returns - proves the anomaly badge/timeline visuals genuinely
// render alert content instead of the NONE/empty placeholders the pre-fix backend forced.
const ELECTRICITY_ANOMALY_FIXTURE = {
  readings: [{ zoneId: 'B202', topic: 'electricity', value: 41.8, timestamp: '2026-07-01T23:15:00Z' }],
  events: [{ zoneId: 'B202', eventType: 'LOAD_ANOMALY', severity: 'BREACH', timestamp: '2026-07-01T23:15:00Z' }],
};
const DOOR_ANOMALY_FIXTURE = {
  readings: [{ zoneId: 'B202', topic: 'door-contact', value: 0, timestamp: '2026-07-01T23:15:00Z' }],
  events: [{ zoneId: 'B202', eventType: 'AFTER_HOURS_SECURITY_EVENT', severity: 'BREACH', timestamp: '2026-07-01T23:15:05Z' }],
};

async function mockApi(page) {
  await page.route('**/zones/*/status', (route) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(STATUS_FIXTURE) })
  );
  await page.route('**/zones/*/history*', (route) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(HISTORY_FIXTURE) })
  );
  await page.route('**/alerts/active', (route) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(ALERTS_FIXTURE) })
  );
}

async function mockApiWithAnomalies(page) {
  await page.route('**/zones/*/status', (route) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(STATUS_FIXTURE) })
  );
  await page.route('**/zones/*/history*', (route) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(HISTORY_FIXTURE) })
  );
  await page.route('**/zones/*/history?topic=electricity', (route) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(ELECTRICITY_ANOMALY_FIXTURE) })
  );
  await page.route('**/zones/*/history?topic=door-contact', (route) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(DOOR_ANOMALY_FIXTURE) })
  );
  await page.route('**/alerts/active', (route) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(ALERTS_FIXTURE) })
  );
}

test('zone grid appearance at desktop width', async ({ page }) => {
  await mockApi(page);
  await page.goto('/');
  await expect(page.locator('.zone-grid-panel')).toHaveScreenshot('zone-grid-desktop.png');
});

test('zone grid appearance at mobile width', async ({ page }) => {
  await mockApi(page);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/');
  await expect(page.locator('.zone-grid-panel')).toHaveScreenshot('zone-grid-mobile.png');
});

test('after-hours-alert row close-up', async ({ page }) => {
  await mockApi(page);
  await page.goto('/');
  const breachRow = page.locator('#zone-grid tr[data-zone-id="B202"]');
  await expect(breachRow).toHaveScreenshot('after-hours-alert-row.png');
});

test('sidebar navigation appearance with a zone selected', async ({ page }) => {
  await mockApi(page);
  await page.goto('/');
  await page.locator('#zone-grid tr[data-zone-id="B202"] .zone-row-btn').click();
  await expect(page.locator('.app-sidebar')).toHaveScreenshot('sidebar-nav-selected.png');
});

test('energy panel appearance with a genuine LOAD_ANOMALY badge', async ({ page }) => {
  await mockApiWithAnomalies(page);
  await page.goto('/');
  await page.locator('#zone-grid tr[data-zone-id="B202"] .zone-row-btn').click();
  await expect(page.locator('#energy-panel')).toHaveScreenshot('energy-panel-load-anomaly.png');
});

test('security timeline appearance with a genuine after-hours event', async ({ page }) => {
  await mockApiWithAnomalies(page);
  await page.goto('/');
  await page.locator('#zone-grid tr[data-zone-id="B202"] .zone-row-btn').click();
  await expect(page.locator('#security-panel')).toHaveScreenshot('security-timeline-populated.png');
});
