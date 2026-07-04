import { test, expect } from "@playwright/test";
import fleetHealth from "../fixtures/fleetHealth.json" with { type: "json" };
import shipmentStatus from "../fixtures/shipmentStatus.json" with { type: "json" };
import excursionHistory from "../fixtures/excursionHistory.json" with { type: "json" };

const API_BASE_URL = "http://localhost:3000";

async function mockChainfrostApi(page) {
  await page.route(`${API_BASE_URL}/fleet/health`, (route) =>
    route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(fleetHealth) })
  );
  await page.route(`${API_BASE_URL}/shipments/*/excursions`, (route) =>
    route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(excursionHistory) })
  );
  await page.route(`${API_BASE_URL}/shipments/*`, (route) =>
    route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(shipmentStatus) })
  );
}

test.beforeEach(async ({ page }) => {
  await mockChainfrostApi(page);
});

test("fleet manifest view - full page screenshot", async ({ page }, testInfo) => {
  await page.goto("/");
  await expect(page.getByTestId("manifest-row")).toHaveCount(3);

  const suffix = testInfo.project.name.includes("mobile") ? "mobile" : "desktop";
  // Console clock ticks every second — mask it so the snapshot stays deterministic.
  await expect(page).toHaveScreenshot(`fleet-manifest-${suffix}.png`, {
    fullPage: true,
    mask: [page.getByTestId("console-clock")],
  });
});

test("BREACH-severity manifest row - close-up screenshot", async ({ page }) => {
  await page.goto("/");
  const breachRow = page.getByTestId("manifest-row").nth(2);
  await expect(breachRow).toBeVisible();

  await expect(breachRow).toHaveScreenshot("breach-manifest-row.png");
});

test("Reefer Health Badge critical state - close-up screenshot", async ({ page }) => {
  await page.goto("/");
  const breachBadge = page.getByTestId("reefer-health-badge").nth(2);
  await expect(breachBadge).toBeVisible();

  await expect(breachBadge).toHaveScreenshot("breach-health-badge.png");
});

test("Shipment Summary card shows a real humidity reading - close-up screenshot", async ({ page }) => {
  await page.goto("/");
  await page.getByTestId("manifest-row").nth(2).click();

  const summary = page.getByTestId("shipment-summary");
  await expect(summary).toBeVisible();
  await expect(summary).toContainText(`${shipmentStatus.humidityPct}%`);

  await expect(summary).toHaveScreenshot("shipment-summary-humidity.png");
});
