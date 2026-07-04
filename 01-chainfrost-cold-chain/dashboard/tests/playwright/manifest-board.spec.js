import { test, expect } from "@playwright/test";
import fleetHealth from "./fixtures/fleetHealth.json" with { type: "json" };
import shipmentStatus from "./fixtures/shipmentStatus.json" with { type: "json" };
import excursionHistory from "./fixtures/excursionHistory.json" with { type: "json" };

const API_BASE_URL = "http://localhost:3000";

// Intercepts every ChainFrost API call so tests never depend on a real backend.
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

test("fleet manifest view loads and renders rows from mocked API", async ({ page }) => {
  await page.goto("/");

  const rows = page.getByTestId("manifest-row");
  await expect(rows).toHaveCount(3);
  await expect(rows.first()).toContainText("TRK-9001-2026-07-02");
  await expect(page.getByTestId("reefer-health-badge").nth(2)).toHaveAttribute("data-status", "BREACH");
});

test("clicking a manifest row navigates to Shipment Lane View with the zone-temp chart", async ({ page }) => {
  await page.goto("/");

  await page.getByTestId("manifest-row").nth(2).click();

  await expect(page.getByTestId("lane-view")).toBeVisible();
  await expect(page.getByTestId("zone-temp-chart")).toBeVisible();
  await expect(page.locator(".info-row").first()).toContainText("TRK-9003");
});

test("Shipment Lane View renders a real humidity reading, not the empty placeholder", async ({ page }) => {
  await page.goto("/");
  await page.getByTestId("manifest-row").nth(2).click();

  const humidityRow = page.locator(".info-row", { hasText: "Humidity" });
  await expect(humidityRow).toContainText(`${shipmentStatus.humidityPct}%`);
  await expect(humidityRow).not.toContainText("--%");
});

test("excursion ledger filters by severity", async ({ page }) => {
  await page.goto("/");
  await page.getByTestId("manifest-row").nth(2).click();

  await page.getByRole("button", { name: "Excursion Ledger" }).click();
  await expect(page.getByTestId("ledger-view")).toBeVisible();

  const rows = page.getByTestId("ledger-row");
  await expect(rows).toHaveCount(4);

  await page.getByTestId("severity-filter").selectOption("BREACH");
  await expect(page.getByTestId("ledger-row")).toHaveCount(1);
  await expect(page.getByTestId("ledger-row").first()).toHaveAttribute("data-severity", "BREACH");

  await page.getByTestId("severity-filter").selectOption("WARN");
  await expect(page.getByTestId("ledger-row")).toHaveCount(2);
});
