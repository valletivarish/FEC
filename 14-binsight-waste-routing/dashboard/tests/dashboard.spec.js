import { test, expect } from "@playwright/test";
import { POPULATED_DEPOT_STATUS } from "./fixtures/depotStatus.js";

async function mockDepotStatus(page, body) {
  await page.route("**/depot/status", (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(body),
    })
  );
}

test.describe("BinSight dashboard — populated data", () => {
  test.beforeEach(async ({ page }) => {
    await mockDepotStatus(page, POPULATED_DEPOT_STATUS);
    await page.goto("/");
  });

  test("kpi row shows correct counts", async ({ page }) => {
    const row = page.locator("#depot-kpi-row");
    await expect(row.locator('[data-kpi="binsDue"]')).toHaveText("2");
    await expect(row.locator('[data-kpi="activeTrucks"]')).toHaveText("1");
    await expect(row.locator('[data-kpi="criticalFireRisk"]')).toHaveText("1");
    await expect(row.locator('[data-kpi="watchFireRisk"]')).toHaveText("1");
    await expect(row.locator('[data-kpi="fogNodes"]')).toHaveText("3");
    const values = page.locator("#depot-kpi-row .kpi-card");
    await expect(values).toHaveCount(5);
  });

  test("risk grid renders 3 tiles with correct color-state classes and bin ids", async ({ page }) => {
    const tiles = page.locator(".risk-tile");
    await expect(tiles).toHaveCount(3);

    const bin01 = page.locator('.risk-tile[data-bin-id="bin-01"]');
    await expect(bin01).toHaveClass(/risk-tile-normal/);
    await expect(bin01).toContainText("bin-01");

    const bin02 = page.locator('.risk-tile[data-bin-id="bin-02"]');
    await expect(bin02).toHaveClass(/risk-tile-watch/);
    await expect(bin02).toContainText("bin-02");

    const bin03 = page.locator('.risk-tile[data-bin-id="bin-03"]');
    await expect(bin03).toHaveClass(/risk-tile-critical/);
    await expect(bin03).toContainText("bin-03");
  });

  test("round queue table renders ranked rows with due-reason pill badges", async ({ page }) => {
    const rows = page.locator("#round-queue-body tr");
    await expect(rows).toHaveCount(2);

    const firstRow = rows.nth(0);
    await expect(firstRow).toContainText("bin-03");
    await expect(firstRow).toContainText("5.15");
    await expect(firstRow.locator(".badge")).toHaveCount(2);
    await expect(firstRow).toContainText("truck-01");

    const secondRow = rows.nth(1);
    await expect(secondRow).toContainText("bin-02");
  });

  test("fleet strip canvas exists with correct id/dimensions and readouts show mocked values", async ({ page }) => {
    const canvas = page.locator("#fleet-strip-canvas");
    await expect(canvas).toHaveAttribute("width", "480");
    await expect(canvas).toHaveAttribute("height", "360");

    await expect(page.getByTestId("depot-weighbridge-tonnage")).toContainText("7.42");
    await expect(page.getByTestId("truck-hopper-fill")).toContainText("63.5");
    await expect(page.getByTestId("truck-fuel-level")).toContainText("81.2");
  });

  test("responsive stacking at mobile width", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    const kpiCard = page.locator("#depot-kpi-row .kpi-card");
    await expect(kpiCard.first()).toBeVisible();
    const grid = page.locator(".bin-risk-grid");
    await expect(grid).toBeVisible();
  });
});

test.describe("BinSight dashboard — no backend", () => {
  test("empty state renders full shell with explanatory message", async ({ page }) => {
    await page.route("**/depot/status", (route) => route.abort("failed"));
    await page.goto("/");

    await expect(page.locator(".brand-name")).toContainText("BinSight");
    await expect(page.locator("#depot-kpi-row")).toBeVisible();
    await expect(page.locator("#bin-risk-grid-status")).toContainText("No live backend data");

    const tiles = page.locator(".risk-tile");
    await expect(tiles).toHaveCount(3);
    await expect(page.locator('.risk-tile[data-bin-id="bin-01"]')).toContainText("bin-01");

    await expect(page.locator("#round-queue-body")).toContainText("No work-list data");
    await expect(page.locator("#fleet-strip-canvas")).toBeVisible();
  });
});
