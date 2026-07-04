import { test, expect } from '@playwright/test';

const BAY_IDS = ['bay-01', 'bay-02', 'bay-03', 'bay-04', 'bay-05', 'bay-06'];

function mockSummary(overrides = {}) {
  return {
    transformer: { windingTemp: 88.5, loadAmps: 240 },
    der: { mode: 'charge_battery_from_solar', solarKw: 12.4, batterySoc: 61, tariffPrice: 18.2 },
    curtailment: { rung: 0, rungLabel: 'normal' },
    curtailmentEvents: [],
    ...overrides,
  };
}

function mockBays() {
  return BAY_IDS.map((bayId, i) => ({
    bayId,
    connectorState: i % 2 === 0 ? 'charging' : 'plugged',
    evSoc: 40 + i * 8,
    setpointAmps: i % 2 === 0 ? 32 : 0,
  }));
}

async function mockApi(page, { summary = mockSummary(), bays = mockBays() } = {}) {
  await page.route('**/hubs/*/summary', (route) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(summary) }),
  );
  await page.route('**/hubs/*/bays', (route) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(bays) }),
  );
}

test.describe('Switchboard functional', () => {
  test('Charger Bays tab is active by default and renders a row for all 6 bays', async ({ page }) => {
    await mockApi(page);
    await page.goto('/');

    await expect(page.getByTestId('tab-btn-bays')).toHaveClass(/active/);
    await expect(page.locator('#tab-bays')).toHaveClass(/active/);

    for (const bayId of BAY_IDS) {
      await expect(page.getByTestId(`bay-row-${bayId}`)).toBeVisible();
    }

    const firstRow = page.getByTestId('bay-row-bay-01');
    await expect(firstRow).toContainText('charging');
    await expect(firstRow).toContainText('40.0');
    await expect(firstRow).toContainText('32.0');
  });

  test('renders hub status line with hub id and rung in the navbar', async ({ page }) => {
    await mockApi(page);
    await page.goto('/');

    const statusLine = page.getByTestId('hub-status-line-inner');
    await expect(statusLine).toBeVisible();
    await expect(statusLine).toContainText('hub-01');
    await expect(page.getByTestId('hub-rung-label')).toHaveText('normal');
  });

  test('Transformer tab switches to reveal transformer status, hiding the bay pane', async ({ page }) => {
    await mockApi(page);
    await page.goto('/');

    await page.getByTestId('tab-btn-transformer').click();

    await expect(page.getByTestId('tab-btn-transformer')).toHaveClass(/active/);
    const line = page.getByTestId('transformer-status-line');
    await expect(line).toBeVisible();
    await expect(line).toContainText('88.5');
    await expect(line).toContainText('240.0');

    await expect(page.locator('#tab-bays')).not.toHaveClass(/active/);
  });

  test('DER tab switches to reveal DER status with mode and values', async ({ page }) => {
    await mockApi(page);
    await page.goto('/');

    await page.getByTestId('tab-btn-der').click();

    await expect(page.getByTestId('tab-btn-der')).toHaveClass(/active/);
    const line = page.getByTestId('der-status-line');
    await expect(line).toBeVisible();
    await expect(line).toContainText('12.4');
    await expect(line).toContainText('61.0');
    await expect(line).toContainText('charge_battery_from_solar');
  });

  test('Curtailment Log tab renders a mocked entry, most recent first', async ({ page }) => {
    const summary = mockSummary({
      curtailment: { rung: 2, rungLabel: 'curtail' },
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
        {
          type: 'curtailment_event',
          hubId: 'hub-01',
          rung: 2,
          rungLabel: 'curtail',
          reason: 'load 372A exceeds rung-2 threshold',
          shedBayId: 'bay-03',
          timestamp: '2026-07-02T10:15:00.000Z',
        },
      ],
    });
    await mockApi(page, { summary });
    await page.goto('/');

    await page.getByTestId('tab-btn-curtailment').click();

    const rows = page.locator('[data-testid="curtailment-log-tbody"] tr');
    await expect(rows.first()).toContainText('2026-07-02T10:15:00.000Z');
    await expect(rows.first()).toContainText('curtail');
    await expect(rows.first()).toContainText('bay-03');
  });

  test('shows empty state when no curtailment events exist', async ({ page }) => {
    await mockApi(page);
    await page.goto('/');

    await page.getByTestId('tab-btn-curtailment').click();
    await expect(page.getByTestId('curtailment-log-tbody')).toContainText('No curtailment events');
  });

  test('only one tab pane is visible at a time on mobile width', async ({ page }) => {
    await mockApi(page);
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto('/');

    await expect(page.getByTestId('bay-roster-table')).toBeVisible();
    await expect(page.locator('#tab-transformer')).toBeHidden();
    await expect(page.locator('#tab-der')).toBeHidden();
    await expect(page.locator('#tab-curtailment')).toBeHidden();

    await page.getByTestId('tab-btn-der').click();
    await expect(page.getByTestId('der-status-line')).toBeVisible();
    await expect(page.locator('#tab-bays')).toBeHidden();
  });

  test('all 4 tab triggers stay reachable and switch panes on desktop width', async ({ page }) => {
    await mockApi(page);
    await page.setViewportSize({ width: 1280, height: 800 });
    await page.goto('/');

    const tabs = page.getByTestId('switchboard-tabs');
    await expect(tabs).toBeVisible();

    for (const testId of ['tab-btn-bays', 'tab-btn-transformer', 'tab-btn-der', 'tab-btn-curtailment']) {
      await expect(page.getByTestId(testId)).toBeVisible();
    }

    await page.getByTestId('tab-btn-transformer').click();
    await expect(page.getByTestId('transformer-status-line')).toBeVisible();

    await page.getByTestId('tab-btn-der').click();
    await expect(page.getByTestId('der-status-line')).toBeVisible();
    await expect(page.getByTestId('transformer-status')).toBeHidden();
  });
});
