import { test, expect } from '@playwright/test';

const ZONE_FIXTURES = {
  'zone-a': {
    zoneId: 'zone-a',
    latestCommand: { zoneId: 'zone-a', ventPositionSetpoint: 55, vpdKpa: 1.05, timestamp: '2026-07-02T10:00:00.000Z' },
    faults: [
      {
        type: 'enclosure_fault_event',
        eventTypeTimestamp: 'enclosure_fault_event#2026-07-02T10:05:00.000Z',
        faultState: 'ENCLOSURE_OK',
        ventPositionActual: 62,
        ventPositionSetpoint: 55,
        timestamp: '2026-07-02T10:05:00.000Z',
        acknowledged: false
      },
      {
        type: 'fertigation_event',
        eventTypeTimestamp: 'fertigation_event#2026-07-02T09:50:00.000Z',
        zoneId: 'zone-a',
        metric: 'ec',
        severity: 'WARNING',
        value: 3.8,
        slopePerReading: 0.35,
        doseDirection: 'decrease_ec_dose',
        lowMoisture: false,
        temperatureCompensationNeeded: true,
        timestamp: '2026-07-02T09:50:00.000Z',
        acknowledged: false
      },
      {
        type: 'fertigation_event',
        eventTypeTimestamp: 'fertigation_event#2026-07-02T09:55:00.000Z',
        zoneId: 'zone-a',
        metric: 'ph',
        severity: 'CRITICAL',
        value: 5.1,
        slopePerReading: null,
        doseDirection: null,
        lowMoisture: true,
        timestamp: '2026-07-02T09:55:00.000Z',
        acknowledged: false
      },
      {
        type: 'fertigation_event',
        eventTypeTimestamp: 'fertigation_event#2026-07-02T09:56:00.000Z',
        zoneId: 'zone-a',
        metric: 'water-temperature',
        severity: 'WARNING',
        value: 30.6,
        slopePerReading: null,
        doseDirection: null,
        lowMoisture: false,
        temperatureCompensationNeeded: true,
        timestamp: '2026-07-02T09:56:00.000Z',
        acknowledged: false
      }
    ]
  },
  'zone-b': {
    zoneId: 'zone-b',
    latestCommand: { zoneId: 'zone-b', ventPositionSetpoint: 40, vpdKpa: 0.7, timestamp: '2026-07-02T10:00:00.000Z' },
    faults: [
      {
        type: 'enclosure_fault_event',
        eventTypeTimestamp: 'enclosure_fault_event#2026-07-02T10:06:00.000Z',
        faultState: 'VENT_STALL',
        ventPositionActual: 20,
        ventPositionSetpoint: 40,
        timestamp: '2026-07-02T10:06:00.000Z',
        acknowledged: false
      }
    ]
  },
  'zone-c': {
    zoneId: 'zone-c',
    latestCommand: { zoneId: 'zone-c', ventPositionSetpoint: 15, vpdKpa: 1.4, timestamp: '2026-07-02T10:00:00.000Z' },
    faults: [
      {
        type: 'enclosure_breach_event',
        eventTypeTimestamp: 'enclosure_breach_event#2026-07-02T10:07:00.000Z',
        doorOpen: true,
        ventPositionSetpoint: 15,
        timestamp: '2026-07-02T10:07:00.000Z',
        acknowledged: false
      },
      {
        type: 'dli_event',
        eventTypeTimestamp: 'dli_event#2026-07-02T18:00:00.000Z',
        accumulatedDli: 12.4,
        shortfall: true,
        timestamp: '2026-07-02T18:00:00.000Z'
      }
    ]
  }
};

async function mockZoneRoutes(page) {
  await page.route('**/zones/*/status', async (route) => {
    const url = route.request().url();
    const match = url.match(/zones\/([^/]+)\/status/);
    const zoneId = match[1];
    const fixture = ZONE_FIXTURES[zoneId];
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(fixture) });
  });

  await page.route('**/faults/acknowledge', async (route) => {
    const body = route.request().postDataJSON();
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ eventTypeTimestamp: body.eventTypeTimestamp, acknowledged: true })
    });
  });
}

test.describe('GreenhouseGuard dashboard - populated data', () => {
  test.beforeEach(async ({ page }) => {
    await mockZoneRoutes(page);
    await page.goto('/');
  });

  test('renders 3 horizontal bench-row cards with gauge and pill state', async ({ page }) => {
    const rows = page.locator('.bench-row-card');
    await expect(rows).toHaveCount(3);

    await expect(rows.nth(0)).toContainText('zone-a');
    await expect(rows.nth(0)).toContainText('62% actual / 55% setpoint');
    await expect(rows.nth(0).locator('.bench-state-pill')).toHaveText('ENCLOSURE_OK');
    await expect(rows.nth(0).locator('.bench-state-pill')).toHaveClass(/text-bg-success/);

    await expect(rows.nth(1)).toContainText('zone-b');
    await expect(rows.nth(1)).toContainText('20% actual / 40% setpoint');
    await expect(rows.nth(1).locator('.bench-state-pill')).toHaveText('Vent Stalled');
    await expect(rows.nth(1).locator('.bench-state-pill')).toHaveClass(/text-bg-warning/);

    await expect(rows.nth(2)).toContainText('zone-c');
    await expect(rows.nth(2).locator('.bench-state-pill')).toHaveText('DOOR BREACH');
    await expect(rows.nth(2).locator('.bench-state-pill')).toHaveClass(/text-bg-danger/);

    const gaugeBar = rows.nth(0).locator('.bench-progress-bar');
    await expect(gaugeBar).toHaveAttribute('style', /width: 62%/);
    const marker = rows.nth(0).locator('.bench-setpoint-marker');
    await expect(marker).toHaveAttribute('style', /left: 55%/);
  });

  test('renders fertigation table with severity pills and dose direction', async ({ page }) => {
    const table = page.locator('#fertigation-table-container table');
    await expect(table).toBeVisible();

    const rows = table.locator('tbody tr');
    await expect(rows).toHaveCount(3);

    const ecRow = rows.filter({ hasText: 'EC' });
    await expect(ecRow.locator('.badge').first()).toHaveText('WARNING');
    await expect(ecRow).toContainText('decrease ec dose');
    await expect(ecRow).toContainText('temp. compensation');

    const phRow = rows.filter({ hasText: 'PH' });
    await expect(phRow.locator('.badge').first()).toHaveText('CRITICAL');
    await expect(phRow).toContainText('low moisture');

    const waterTempRow = rows.filter({ hasText: 'WATER-TEMPERATURE' });
    await expect(waterTempRow.locator('.badge').first()).toHaveText('WARNING');
    await expect(waterTempRow).toContainText('30.6');
    await expect(waterTempRow).toContainText('temp. compensation');
  });

  test('renders KPI summary cards from live zone data', async ({ page }) => {
    const cards = page.locator('.kpi-card');
    await expect(cards).toHaveCount(5);

    const zonesCard = cards.filter({ hasText: 'Zones Monitored' });
    await expect(zonesCard.locator('.kpi-value')).toHaveText('3');

    const channelsCard = cards.filter({ hasText: 'Sensor Channels' });
    await expect(channelsCard.locator('.kpi-value')).toHaveText('30');

    // zone-a EC WARNING + PH CRITICAL + water-temp WARNING + zone-b VENT_STALL + zone-c breach = 5
    const faultsCard = cards.filter({ hasText: 'Active Faults' });
    await expect(faultsCard.locator('.kpi-value')).toHaveText('5');

    const dliCard = cards.filter({ hasText: 'DLI Shortfalls' });
    await expect(dliCard.locator('.kpi-value')).toHaveText('1');
  });

  test('renders faults log and acknowledges a fault row', async ({ page }) => {
    const logTable = page.locator('#faults-log-container table');
    await expect(logTable).toBeVisible();

    const dliRow = logTable.locator('tbody tr', { hasText: 'dli event' });
    await expect(dliRow).toContainText('12.4');
    await expect(dliRow.locator('.btn-acknowledge')).toHaveCount(0);

    const breachRow = logTable.locator('tbody tr', { hasText: 'enclosure breach event' });
    const ackButton = breachRow.locator('.btn-acknowledge');
    await expect(ackButton).toBeVisible();

    await ackButton.click();
    await expect(breachRow).toHaveClass(/table-secondary/);
    await expect(breachRow.locator('.badge')).toHaveText('Acknowledged');
  });

  test('stacks responsively at mobile width', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    const rows = page.locator('.bench-row-card');
    await expect(rows).toHaveCount(3);

    const box0 = await rows.nth(0).boundingBox();
    const box1 = await rows.nth(1).boundingBox();
    expect(box1.y).toBeGreaterThan(box0.y + box0.height - 5);
  });
});

test.describe('GreenhouseGuard dashboard - co2_event in faults log', () => {
  test('renders a CO2 severity transition in the faults log', async ({ page }) => {
    await page.route('**/zones/*/status', async (route) => {
      const url = route.request().url();
      const zoneId = url.match(/zones\/([^/]+)\/status/)[1];
      const fixture =
        zoneId === 'zone-a'
          ? {
              zoneId,
              latestCommand: null,
              faults: [
                {
                  type: 'co2_event',
                  eventTypeTimestamp: 'co2_event#2026-07-02T11:00:00.000Z',
                  zoneId,
                  co2Ppm: 1800,
                  severity: 'WARNING',
                  timestamp: '2026-07-02T11:00:00.000Z',
                  acknowledged: false
                }
              ]
            }
          : { zoneId, latestCommand: null, faults: [] };
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(fixture) });
    });
    await page.goto('/');

    const logTable = page.locator('#faults-log-container table');
    const co2Row = logTable.locator('tbody tr', { hasText: 'co2 event' });
    await expect(co2Row).toContainText('CO2 WARNING at 1800 ppm');

    const activeFaultsCard = page.locator('.kpi-card').filter({ hasText: 'Active Faults' });
    await expect(activeFaultsCard.locator('.kpi-value')).toHaveText('1');
  });
});

test.describe('GreenhouseGuard dashboard - no backend', () => {
  test('renders full shell with explanatory empty state', async ({ page }) => {
    await page.route('**/zones/*/status', async (route) => {
      await route.fulfill({ status: 500, contentType: 'application/json', body: JSON.stringify({ error: 'down' }) });
    });
    await page.goto('/');

    await expect(page.locator('.brand-name')).toContainText('GreenhouseGuard');
    await expect(page.locator('.section-title')).toContainText(['Bench Overview', 'Fertigation', 'Faults & DLI Log']);
    await expect(page.locator('.bench-empty-state')).toContainText('No live bench data yet');
    await expect(page.locator('.bench-row-card')).toHaveCount(0);

    // KPI cards render even with no backend — every count falls back to 0
    await expect(page.locator('.kpi-card')).toHaveCount(5);
    const zonesCard = page.locator('.kpi-card').filter({ hasText: 'Zones Monitored' });
    await expect(zonesCard.locator('.kpi-value')).toHaveText('0');
  });
});
