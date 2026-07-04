import { test, expect } from "@playwright/test";
import { POPULATED_DEPOT_STATUS } from "./fixtures/depotStatus.js";

async function mockDepotStatus(page) {
  await page.route("**/depot/status", (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(POPULATED_DEPOT_STATUS),
    })
  );
}

test.describe("BinSight dashboard — visual regression", () => {
  test("desktop populated layout", async ({ page }) => {
    await mockDepotStatus(page);
    await page.setViewportSize({ width: 1280, height: 800 });
    await page.goto("/");
    await expect(page.locator(".risk-tile")).toHaveCount(3);
    await expect(page).toHaveScreenshot("dashboard-desktop-populated.png", {
      fullPage: true,
      maxDiffPixelRatio: 0.02,
    });
  });

  test("mobile populated layout", async ({ page }) => {
    await mockDepotStatus(page);
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto("/");
    await expect(page.locator(".risk-tile")).toHaveCount(3);
    await expect(page).toHaveScreenshot("dashboard-mobile-populated.png", {
      fullPage: true,
      maxDiffPixelRatio: 0.02,
    });
  });
});
