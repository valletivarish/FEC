import { test, expect } from "@playwright/test";

// Must match the real zone_id values published by sensors/profiles/*.yaml, not invented labels.
const ZONE_IDS = ["zone-default", "zone-server-room", "zone-meeting-room"];

// Mirrors the real zone_query Lambda's { zone_id, sensors: [...] } shape (backend/functions/zone_query/handler.py),
// one latest-advisory-item per sensor - not a flat status object with band/comfort_index/occupied fields.
function statusPayload(zoneId, { band = "good" } = {}) {
  return {
    zone_id: zoneId,
    sensors: [
      { zone_id: zoneId, sensor: "pm25", advisory_type: "band_change", band, value: 20.0, details: {}, timestamp: "2026-07-02T09:00:00.000Z" },
      { zone_id: zoneId, sensor: "occupancy_pir", advisory_type: "band_change", band: null, value: 1, details: {}, timestamp: "2026-07-02T09:00:01.000Z" },
      { zone_id: zoneId, sensor: "comfort", advisory_type: "comfort_alert", band: null, value: 72, details: {}, timestamp: "2026-07-02T09:00:02.000Z" },
    ],
  };
}

// Mirrors the real { zone_id, events: [...] } history shape: a flat, ascending list of per-sensor advisory events.
function historyPayload(zoneId) {
  const sensors = ["co2", "pm25", "pm10", "tvoc", "temperature", "humidity", "co", "no2", "hcho", "occupancy_pir"];
  const events = sensors.flatMap((sensor) =>
    [1, 2, 3, 4, 5].map((value, i) => ({
      zone_id: zoneId,
      sensor,
      advisory_type: "band_change",
      band: "good",
      value,
      details: {},
      timestamp: `2026-07-02T09:0${i}:00.000Z`,
    }))
  );
  return { zone_id: zoneId, events };
}

async function mockZoneApi(page, { bandOverrideZoneId } = {}) {
  await page.route("**/zones/*/status", async (route) => {
    const url = route.request().url();
    const zoneId = decodeURIComponent(url.split("/zones/")[1].split("/status")[0]);
    const overrides = zoneId === bandOverrideZoneId ? { band: "unhealthy" } : {};
    await route.fulfill({ json: statusPayload(zoneId, overrides) });
  });
  await page.route("**/zones/*/history", async (route) => {
    const url = route.request().url();
    const zoneId = decodeURIComponent(url.split("/zones/")[1].split("/history")[0]);
    await route.fulfill({ json: historyPayload(zoneId) });
  });
  await page.route("**/config/*", async (route) => {
    if (route.request().method() === "PUT") {
      await route.fulfill({ json: { ok: true } });
      return;
    }
    await route.fulfill({ json: {} });
  });
}

test("VentBoard loads and renders one KPI tile per zone", async ({ page }) => {
  await mockZoneApi(page);
  await page.goto("/");
  const tiles = page.locator(".ventboard-grid .zone-tile");
  await expect(tiles).toHaveCount(ZONE_IDS.length);
});

test("clicking a tile opens zone detail with 10 sensor rows and sparklines", async ({ page }) => {
  await mockZoneApi(page);
  await page.goto("/");
  await page.locator(".zone-tile").first().click();
  await expect(page.locator(".sensor-row")).toHaveCount(10);
  await expect(page.locator(".sensor-row .sparkline")).toHaveCount(10);
});

test("config form PUT submits and shows a success message", async ({ page }) => {
  await mockZoneApi(page);
  await page.goto("/");
  await page.locator(".zone-tile").first().click();
  await page.locator('[data-action="config"]').click();
  await expect(page.locator("#zone-config-form")).toBeVisible();
  await page.locator('button[type="submit"]').click();
  await expect(page.locator(".config-form__message")).toHaveText("Saved successfully.");
});

test("an injected unhealthy-band mocked response updates a tile's band badge", async ({ page }) => {
  await mockZoneApi(page, { bandOverrideZoneId: "zone-default" });
  await page.goto("/");
  const firstBadge = page.locator(".zone-tile").first().locator(".badge").first();
  await expect(firstBadge).toHaveText("Unhealthy");
  await expect(firstBadge).toHaveClass(/text-bg-danger/);
});

test("KPI grid reflows from a single column to three columns as viewport widens", async ({ page }) => {
  await mockZoneApi(page);
  await page.goto("/");
  const tiles = page.locator(".ventboard-grid .zone-tile");
  await expect(tiles).toHaveCount(ZONE_IDS.length);

  const viewportWidth = page.viewportSize()?.width ?? 1280;
  const firstTileBox = await tiles.first().boundingBox();
  const secondTileBox = await tiles.nth(1).boundingBox();

  if (viewportWidth < 768) {
    // Bootstrap's row-cols-1 keeps tiles stacked below md breakpoint - each tile spans the full row.
    expect(secondTileBox.y).toBeGreaterThan(firstTileBox.y);
  } else {
    // row-cols-md-3 lays tiles out three per row - the second tile sits beside the first, not below it.
    expect(secondTileBox.y).toBeCloseTo(firstTileBox.y, 0);
  }
});
