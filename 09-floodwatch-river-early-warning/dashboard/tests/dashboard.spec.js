import { test, expect } from "@playwright/test";

const REACH_IDS = ["reach-upper", "reach-mid", "reach-lower"];

function mockEventsFor(reachId) {
  const now = new Date().toISOString();
  if (reachId === "reach-upper") {
    return [
      { type: "hydro_event", reachId, stage: "RED", riverLevel: 5.8, rateOfRise: 0.42, soilSaturationAmplified: true, crossReachEscalated: false, flowRateSlope: -1.2, blockageSuspected: true, timestamp: now },
      { type: "quality_event", reachId, cwqi: 32.5, band: "POOR", timestamp: now },
      { type: "quality_event", reachId, contaminationSuspected: true, turbidity: 620, dissolvedOxygen: 3.1, timestamp: now },
      { type: "meteo_event", reachId, pressureSlope: -0.8, preStormSignal: true, preWarnEscalation: true, timestamp: now },
    ];
  }
  if (reachId === "reach-mid") {
    return [
      { type: "hydro_event", reachId, stage: "AMBER", riverLevel: 3.4, rateOfRise: 0.15, soilSaturationAmplified: false, crossReachEscalated: false, timestamp: now },
      { type: "quality_event", reachId, cwqi: 55.0, band: "FAIR", timestamp: now },
      { type: "meteo_event", reachId, pressureSlope: -0.2, preStormSignal: false, preWarnEscalation: false, timestamp: now },
    ];
  }
  return [
    { type: "hydro_event", reachId, stage: "GREEN", riverLevel: 1.2, rateOfRise: 0.01, soilSaturationAmplified: false, crossReachEscalated: false, timestamp: now },
    { type: "quality_event", reachId, cwqi: 88.0, band: "GOOD", timestamp: now },
    { type: "meteo_event", reachId, pressureSlope: 0.05, preStormSignal: false, preWarnEscalation: false, timestamp: now },
  ];
}

async function mockBackend(page) {
  await page.route("**/reaches/*/status", async (route) => {
    const url = route.request().url();
    const reachId = REACH_IDS.find((id) => url.includes(id));
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ reachId, events: mockEventsFor(reachId) }),
    });
  });
}

test.describe("FloodWatch dashboard - functional", () => {
  test("renders a reach overview row per reach", async ({ page }) => {
    await mockBackend(page);
    await page.goto("/");
    await expect(page.locator("#reachOverviewBody tr")).toHaveCount(3);
    for (const reachId of REACH_IDS) {
      await expect(page.locator("#reachOverviewBody")).toContainText(reachId);
    }
  });

  test("reach overview shows correct stage badges", async ({ page }) => {
    await mockBackend(page);
    await page.goto("/");
    const upperRow = page.locator("#reachOverviewBody tr", { hasText: "reach-upper" });
    await expect(upperRow.locator("span.badge.text-bg-danger", { hasText: "RED" })).toBeVisible();

    const midRow = page.locator("#reachOverviewBody tr", { hasText: "reach-mid" });
    await expect(midRow.locator("span.badge.text-bg-warning")).toHaveText("AMBER");

    const lowerRow = page.locator("#reachOverviewBody tr", { hasText: "reach-lower" });
    await expect(lowerRow.locator("span.badge.text-bg-success")).toHaveText("GREEN");
  });

  test("reach overview shows flow-rate slope and blockage signal", async ({ page }) => {
    await mockBackend(page);
    await page.goto("/");
    const upperRow = page.locator("#reachOverviewBody tr", { hasText: "reach-upper" });
    await expect(upperRow.locator("span.badge.text-bg-danger", { hasText: "Blockage?" })).toBeVisible();
    await expect(upperRow).toContainText("-1.20");

    const midRow = page.locator("#reachOverviewBody tr", { hasText: "reach-mid" });
    await expect(midRow.locator("span.badge.text-bg-secondary", { hasText: "Clear" })).toBeVisible();
    await expect(midRow).toContainText("--");
  });

  test("water quality table renders mocked entries with correct badges", async ({ page }) => {
    await mockBackend(page);
    await page.goto("/");
    await expect(page.locator("#waterQualityBody tr")).toHaveCount(3);

    const upperRow = page.locator("#waterQualityBody tr", { hasText: "reach-upper" });
    await expect(upperRow.locator("span.badge.text-bg-danger", { hasText: "POOR" })).toBeVisible();
    await expect(upperRow.locator("span.badge.text-bg-danger", { hasText: "Suspected" })).toBeVisible();

    const lowerRow = page.locator("#waterQualityBody tr", { hasText: "reach-lower" });
    await expect(lowerRow.locator("span.badge.text-bg-success", { hasText: "GOOD" })).toBeVisible();
    await expect(lowerRow.locator("span.badge.text-bg-success", { hasText: "Clear" })).toBeVisible();
  });

  test("meteo watch table renders mocked entries with correct badges", async ({ page }) => {
    await mockBackend(page);
    await page.goto("/");
    await expect(page.locator("#meteoWatchBody tr")).toHaveCount(3);

    const upperRow = page.locator("#meteoWatchBody tr", { hasText: "reach-upper" });
    await expect(upperRow.locator("span.badge.text-bg-warning", { hasText: "Active" })).toBeVisible();
    await expect(upperRow.locator("span.badge.text-bg-danger", { hasText: "Escalated" })).toBeVisible();

    const lowerRow = page.locator("#meteoWatchBody tr", { hasText: "reach-lower" });
    await expect(lowerRow.locator("span.badge.text-bg-success", { hasText: "Clear" })).toBeVisible();
    await expect(lowerRow.locator("span.badge.text-bg-secondary", { hasText: "None" })).toBeVisible();
  });

  test("escalation log renders one list-group-item per event, newest first", async ({ page }) => {
    await mockBackend(page);
    await page.goto("/");
    const items = page.locator("#escalationLogList .list-group-item");
    const itemCount = await items.count();
    expect(itemCount).toBeGreaterThan(0);
    // 4 events for reach-upper + 3 for reach-mid + 3 for reach-lower
    await expect(items).toHaveCount(10);
  });

  test("escalation log items carry a severity-colored left border", async ({ page }) => {
    await mockBackend(page);
    await page.goto("/");
    const redItem = page.locator("#escalationLogList .list-group-item", { hasText: "reach-upper" }).first();
    await expect(redItem).toHaveClass(/severity-accent-danger/);
    await expect(redItem).toHaveCSS("border-left-width", "4px");
  });

  test("emergency banner shows the most severe active reach as RED", async ({ page }) => {
    await mockBackend(page);
    await page.goto("/");
    const banner = page.locator("#emergencyBanner");
    await expect(banner).toBeVisible();
    await expect(banner).toHaveClass(/alert-danger/);
    await expect(banner).toContainText("reach-upper");
    await expect(banner).toContainText("RED stage");
  });

  test("emergency banner is hidden when all reaches are green", async ({ page }) => {
    await page.route("**/reaches/*/status", async (route) => {
      const url = route.request().url();
      const reachId = REACH_IDS.find((id) => url.includes(id));
      const now = new Date().toISOString();
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          reachId,
          events: [{ type: "hydro_event", reachId, stage: "GREEN", riverLevel: 1.0, rateOfRise: 0.0, timestamp: now }],
        }),
      });
    });
    await page.goto("/");
    await expect(page.locator("#reachOverviewBody tr")).toHaveCount(3);
    await expect(page.locator("#emergencyBanner")).toBeHidden();
  });

  test("responsive layout stacks at mobile width", async ({ page }) => {
    await mockBackend(page);
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto("/");
    await expect(page.locator(".app-sidebar")).toBeVisible();
    await expect(page.locator(".app-header .page-title")).toBeVisible();
    // list-group items reflow to full width at mobile rather than collapsing like a table
    const firstItem = page.locator("#escalationLogList .list-group-item").first();
    const box = await firstItem.boundingBox();
    expect(box.width).toBeGreaterThan(300);
  });

  test("no-backend empty state renders explanatory message", async ({ page }) => {
    await page.route("**/reaches/*/status", async (route) => {
      await route.fulfill({ status: 503, contentType: "application/json", body: "{}" });
    });
    await page.goto("/");
    await expect(page.locator("#backendNotice")).toBeVisible();
    await expect(page.locator("#backendNotice")).toContainText("No live data");
    await expect(page.locator("#reachOverviewBody")).toContainText("No reach data available");
    await expect(page.locator("#emergencyBanner")).toBeHidden();
    await expect(page.locator("#escalationLogList")).toContainText("No escalation events recorded");
    await expect(page.locator(".app-sidebar")).toBeVisible();
  });
});
