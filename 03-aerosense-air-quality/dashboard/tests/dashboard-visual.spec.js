import { test, expect } from "@playwright/test";

// Mirrors the real zone_query Lambda's { zone_id, sensors: [...] } shape (backend/functions/zone_query/handler.py).
function statusPayload(zoneId, band) {
  return {
    zone_id: zoneId,
    sensors: [
      { zone_id: zoneId, sensor: "pm25", advisory_type: "band_change", band, value: 20.0, details: {}, timestamp: "2026-07-02T09:00:00.000Z" },
      { zone_id: zoneId, sensor: "occupancy_pir", advisory_type: "band_change", band: null, value: 1, details: {}, timestamp: "2026-07-02T09:00:01.000Z" },
      { zone_id: zoneId, sensor: "comfort", advisory_type: "comfort_alert", band: null, value: 65, details: {}, timestamp: "2026-07-02T09:00:02.000Z" },
    ],
  };
}

async function mockStableApi(page, band = "good") {
  await page.route("**/zones/*/status", async (route) => {
    const zoneId = decodeURIComponent(route.request().url().split("/zones/")[1].split("/status")[0]);
    await route.fulfill({ json: statusPayload(zoneId, band) });
  });
  await page.route("**/zones/*/history", async (route) => {
    const zoneId = decodeURIComponent(route.request().url().split("/zones/")[1].split("/history")[0]);
    await route.fulfill({ json: { zone_id: zoneId, events: [] } });
  });
}

test("VentBoard grid visual snapshot", async ({ page }) => {
  await mockStableApi(page);
  await page.goto("/");
  await expect(page.locator(".ventboard-grid")).toBeVisible();
  await expect(page).toHaveScreenshot("ventboard-grid.png", { fullPage: true });
});

test("plain band value/label across band color states", async ({ page }) => {
  // setContent keeps the page's current base URL, so root-relative module imports
  // need a prior navigation to the dev server origin to resolve at all.
  await page.goto("/");
  await page.setContent(`
    <html><body style="margin:0;background:#f4f6f5;padding:24px;">
      <link rel="stylesheet" href="/src/styles/theme.css" />
      <div id="good"></div>
      <div id="unhealthy"></div>
      <script type="module">
        import { renderBandGauge } from "/src/components/band-gauge.js";
        document.getElementById("good").innerHTML = renderBandGauge({ value: 40, unit: "ppm", fraction: 0.15, band: "good" });
        document.getElementById("unhealthy").innerHTML = renderBandGauge({ value: 180, unit: "ppm", fraction: 0.8, band: "unhealthy" });
      </script>
    </body></html>
  `);
  await page.waitForSelector("#good .band-gauge");
  await expect(page.locator("#good")).toHaveScreenshot("band-gauge-good.png");
  await expect(page.locator("#unhealthy")).toHaveScreenshot("band-gauge-unhealthy.png");
});
