import { test, expect } from '@playwright/test';

const BAY_IDS = ['bay-01', 'bay-02', 'bay-03', 'bay-04', 'bay-05', 'bay-06'];
const STATES = ['charging', 'plugged', 'unplugged', 'fault', 'charging', 'plugged'];

// fixed, deterministic payload so snapshots are stable across runs — no random or time-based values
const STABLE_SUMMARY = {
  transformer: { windingTemp: 92, loadAmps: 268 },
  der: { mode: 'discharge_to_grid', solarKw: 4.2, batterySoc: 74, tariffPrice: 32.5 },
  curtailment: { rung: 1, rungLabel: 'advisory' },
  curtailmentEvents: [
    {
      type: 'curtailment_event',
      hubId: 'hub-01',
      rung: 1,
      rungLabel: 'advisory',
      reason: 'load 332A crossed advisory threshold',
      shedBayId: null,
      timestamp: '2026-07-02T09:00:00.000Z',
    },
  ],
};

const STABLE_BAYS = BAY_IDS.map((bayId, i) => ({
  bayId,
  connectorState: STATES[i],
  evSoc: STATES[i] === 'unplugged' ? null : 30 + i * 10,
  setpointAmps: STATES[i] === 'charging' ? 25.6 : 0,
}));

async function mockStableApi(page) {
  await page.route('**/hubs/*/summary', (route) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(STABLE_SUMMARY) }),
  );
  await page.route('**/hubs/*/bays', (route) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(STABLE_BAYS) }),
  );
}

test.describe('Switchboard visual regression', () => {
  test('full-page desktop snapshot — Charger Bays tab (default)', async ({ page }) => {
    await mockStableApi(page);
    await page.setViewportSize({ width: 1280, height: 800 });
    await page.goto('/');
    await expect(page.getByTestId('bay-row-bay-06')).toBeVisible();

    await expect(page).toHaveScreenshot('switchboard-desktop-bays.png', { fullPage: true });
  });

  test('full-page mobile snapshot — Charger Bays tab (default)', async ({ page }) => {
    await mockStableApi(page);
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto('/');
    await expect(page.getByTestId('bay-row-bay-06')).toBeVisible();

    await expect(page).toHaveScreenshot('switchboard-mobile-bays.png', { fullPage: true });
  });

  test('full-page desktop snapshot — Curtailment Log tab', async ({ page }) => {
    await mockStableApi(page);
    await page.setViewportSize({ width: 1280, height: 800 });
    await page.goto('/');
    await expect(page.getByTestId('bay-row-bay-06')).toBeVisible();

    await page.getByTestId('tab-btn-curtailment').click();
    await expect(page.locator('[data-testid="curtailment-log-tbody"] tr').first()).toBeVisible();

    await expect(page).toHaveScreenshot('switchboard-desktop-curtailment.png', { fullPage: true });
  });

  test('bay roster table close-up snapshot', async ({ page }) => {
    await mockStableApi(page);
    await page.setViewportSize({ width: 1280, height: 800 });
    await page.goto('/');
    await expect(page.getByTestId('bay-row-bay-06')).toBeVisible();

    await expect(page.getByTestId('bay-roster-table')).toHaveScreenshot('bay-roster-table.png');
  });
});
