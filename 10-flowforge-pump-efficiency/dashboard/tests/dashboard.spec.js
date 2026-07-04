import { test, expect } from '@playwright/test';

const PUMP_IDS = ['pump-01', 'pump-02', 'pump-03'];

const MOCK_INSIGHTS = {
  'pump-01': [
    {
      type: 'health_event',
      pumpId: 'pump-01',
      trigger: 'mad_anomaly',
      madScore: 4.1,
      vibration: 8.3,
      bearingTemp: 71.2,
      motorCurrent: 22.5,
      rpm: 1750,
      timestamp: '2026-07-02T10:00:00Z',
    },
    {
      type: 'hydraulics_event',
      pumpId: 'pump-01',
      severity: 'CRITICAL',
      efficiency: 0.41,
      predictedEfficiency: 0.63,
      deviationPercentagePoints: 22.0,
      timestamp: '2026-07-02T10:01:00Z',
    },
    {
      type: 'integrity_event',
      pumpId: 'pump-01',
      state: 'LEAK_WATCH',
      sealLeak: 34.2,
      trendSlope: 0.12,
      turbidity: 18.4,
      timestamp: '2026-07-02T10:02:00Z',
    },
  ],
  'pump-02': [
    {
      type: 'health_event',
      pumpId: 'pump-02',
      trigger: 'cusum_changepoint',
      madScore: 1.2,
      vibration: 5.1,
      bearingTemp: 60.4,
      motorCurrent: 18.9,
      rpm: 1600,
      timestamp: '2026-07-02T09:55:00Z',
    },
    {
      type: 'integrity_event',
      pumpId: 'pump-02',
      state: 'LEAK_CRITICAL',
      sealLeak: 48.7,
      trendSlope: 0.55,
      turbidity: 31.6,
      timestamp: '2026-07-02T09:56:00Z',
    },
  ],
  'pump-03': [
    {
      type: 'health_event',
      pumpId: 'pump-03',
      trigger: 'heartbeat',
      madScore: 0.3,
      vibration: 2.4,
      bearingTemp: 48.1,
      motorCurrent: 12.1,
      rpm: 1450,
      timestamp: '2026-07-02T09:50:00Z',
    },
  ],
};

async function mockApi(page, insightsByPump = MOCK_INSIGHTS) {
  await page.route('**/pumps/*/insights', async (route) => {
    const url = new URL(route.request().url());
    const pumpId = url.pathname.split('/').filter(Boolean).slice(-2, -1)[0];
    const body = insightsByPump[pumpId] || [];
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(body) });
  });
}

async function mockEmptyApi(page) {
  await page.route('**/pumps/*/insights', async (route) => {
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify([]) });
  });
}

test.describe('FlowForge dashboard — functional', () => {
  test('renders one pump health row per pump with correct trigger badges', async ({ page }) => {
    await mockApi(page);
    await page.goto('/');

    const table = page.getByTestId('pump-health-table');
    for (const pumpId of PUMP_IDS) {
      await expect(table.locator(`tr[data-pump-id="${pumpId}"]`)).toBeVisible();
    }

    const pump01Row = table.locator('tr[data-pump-id="pump-01"]');
    await expect(pump01Row.locator('.badge')).toHaveText('mad_anomaly');
    await expect(pump01Row.locator('.badge')).toHaveClass(/text-bg-danger/);

    const pump02Row = table.locator('tr[data-pump-id="pump-02"]');
    await expect(pump02Row.locator('.badge')).toHaveText('cusum_changepoint');
    await expect(pump02Row.locator('.badge')).toHaveClass(/text-bg-warning/);

    const pump03Row = table.locator('tr[data-pump-id="pump-03"]');
    await expect(pump03Row.locator('.badge')).toHaveText('heartbeat');
    await expect(pump03Row.locator('.badge')).toHaveClass(/text-bg-secondary/);
  });

  test('renders pump health motor current and rpm columns with real values', async ({ page }) => {
    await mockApi(page);
    await page.goto('/');

    const table = page.getByTestId('pump-health-table');
    const pump01Row = table.locator('tr[data-pump-id="pump-01"]');
    await expect(pump01Row).toContainText('22.5 A');
    await expect(pump01Row).toContainText('1750 RPM');

    const pump02Row = table.locator('tr[data-pump-id="pump-02"]');
    await expect(pump02Row).toContainText('18.9 A');
    await expect(pump02Row).toContainText('1600 RPM');
  });

  test('renders hydraulic efficiency table with severity pill', async ({ page }) => {
    await mockApi(page);
    await page.goto('/');

    const table = page.getByTestId('hydraulic-efficiency-table');
    const row = table.locator('tr[data-pump-id="pump-01"]');
    await expect(row).toContainText('41.0%');
    await expect(row).toContainText('63.0%');
    await expect(row).toContainText('22.0 pp');
    await expect(row.locator('.badge')).toHaveText('CRITICAL');
    await expect(row.locator('.badge')).toHaveClass(/text-bg-danger/);
  });

  test('renders seal integrity table with state pill', async ({ page }) => {
    await mockApi(page);
    await page.goto('/');

    const table = page.getByTestId('seal-integrity-table');
    const watchRow = table.locator('tr[data-pump-id="pump-01"]');
    await expect(watchRow.locator('.badge')).toHaveText('LEAK_WATCH');
    await expect(watchRow.locator('.badge')).toHaveClass(/text-bg-warning/);

    const criticalRow = table.locator('tr[data-pump-id="pump-02"]');
    await expect(criticalRow.locator('.badge')).toHaveText('LEAK_CRITICAL');
    await expect(criticalRow.locator('.badge')).toHaveClass(/text-bg-danger/);
  });

  test('renders seal integrity turbidity column with real values', async ({ page }) => {
    await mockApi(page);
    await page.goto('/');

    const table = page.getByTestId('seal-integrity-table');
    const watchRow = table.locator('tr[data-pump-id="pump-01"]');
    await expect(watchRow).toContainText('18.4 NTU');

    const criticalRow = table.locator('tr[data-pump-id="pump-02"]');
    await expect(criticalRow).toContainText('31.6 NTU');
  });

  test('renders insight log with all mocked entries, most recent first', async ({ page }) => {
    await mockApi(page);
    await page.goto('/');

    const table = page.getByTestId('insight-log-table');
    const rows = table.locator('tbody tr');
    await expect(rows).toHaveCount(6);

    const firstRowTimestampCell = rows.first().locator('td').first();
    await expect(firstRowTimestampCell).toContainText('2026');
  });

  test('responsive layout stacks tables at mobile width', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await mockApi(page);
    await page.goto('/');

    const healthCard = page.locator('#pump-health-container .card');
    const efficiencyCard = page.locator('#hydraulic-efficiency-container .card');

    const healthBox = await healthCard.boundingBox();
    const efficiencyBox = await efficiencyCard.boundingBox();

    expect(healthBox).not.toBeNull();
    expect(efficiencyBox).not.toBeNull();
    expect(efficiencyBox.y).toBeGreaterThan(healthBox.y + healthBox.height - 1);
  });

  test('no-backend empty state renders explanatory message with full shell', async ({ page }) => {
    await mockEmptyApi(page);
    await page.goto('/');

    await expect(page.getByTestId('empty-state')).toBeVisible();
    await expect(page.getByTestId('empty-state')).toContainText('No live data — start the local stack to see readings');

    await expect(page.locator('.navbar-brand')).toContainText('FlowForge');
    await expect(page.getByTestId('pump-health-table')).toBeVisible();
    await expect(page.getByTestId('pump-health-table').locator('tbody tr')).toHaveCount(3);
  });
});
