import { test, expect } from "@playwright/test";

const REACH_IDS = ["reach-upper", "reach-mid", "reach-lower"];
const FIXED_TIMESTAMP = "2026-01-15T09:30:00.000Z";

function stableEventsFor(reachId) {
  if (reachId === "reach-upper") {
    return [
      { type: "hydro_event", reachId, stage: "RED", riverLevel: 5.8, rateOfRise: 0.42, soilSaturationAmplified: true, crossReachEscalated: false, flowRateSlope: -1.2, blockageSuspected: true, timestamp: FIXED_TIMESTAMP },
      { type: "quality_event", reachId, cwqi: 32.5, band: "POOR", timestamp: FIXED_TIMESTAMP },
      { type: "quality_event", reachId, contaminationSuspected: true, turbidity: 620, dissolvedOxygen: 3.1, timestamp: FIXED_TIMESTAMP },
      { type: "meteo_event", reachId, pressureSlope: -0.8, preStormSignal: true, preWarnEscalation: true, timestamp: FIXED_TIMESTAMP },
    ];
  }
  if (reachId === "reach-mid") {
    return [
      { type: "hydro_event", reachId, stage: "AMBER", riverLevel: 3.4, rateOfRise: 0.15, soilSaturationAmplified: false, crossReachEscalated: false, timestamp: FIXED_TIMESTAMP },
      { type: "quality_event", reachId, cwqi: 55.0, band: "FAIR", timestamp: FIXED_TIMESTAMP },
      { type: "meteo_event", reachId, pressureSlope: -0.2, preStormSignal: false, preWarnEscalation: false, timestamp: FIXED_TIMESTAMP },
    ];
  }
  return [
    { type: "hydro_event", reachId, stage: "GREEN", riverLevel: 1.2, rateOfRise: 0.01, soilSaturationAmplified: false, crossReachEscalated: false, timestamp: FIXED_TIMESTAMP },
    { type: "quality_event", reachId, cwqi: 88.0, band: "GOOD", timestamp: FIXED_TIMESTAMP },
    { type: "meteo_event", reachId, pressureSlope: 0.05, preStormSignal: false, preWarnEscalation: false, timestamp: FIXED_TIMESTAMP },
  ];
}

async function mockStableBackend(page) {
  await page.route("**/reaches/*/status", async (route) => {
    const url = route.request().url();
    const reachId = REACH_IDS.find((id) => url.includes(id));
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ reachId, events: stableEventsFor(reachId) }),
    });
  });
}

test.describe("FloodWatch dashboard - visual regression", () => {
  test("desktop full page snapshot with populated data", async ({ page }) => {
    await mockStableBackend(page);
    await page.goto("/");
    await expect(page.locator("#reachOverviewBody tr")).toHaveCount(3);
    await expect(page).toHaveScreenshot("dashboard-desktop.png", { fullPage: true });
  });

  test("mobile full page snapshot with populated data", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await mockStableBackend(page);
    await page.goto("/");
    await expect(page.locator("#reachOverviewBody tr")).toHaveCount(3);
    await expect(page).toHaveScreenshot("dashboard-mobile.png", { fullPage: true });
  });
});
