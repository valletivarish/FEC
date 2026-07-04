import { renderVentBoardGrid } from "./components/ventboard-grid.js";
import { renderZoneDetail } from "./views/zone-detail.js";
import { renderZoneConfig } from "./views/zone-config.js";

const views = {
  ventboard: document.getElementById("view-ventboard"),
  detail: document.getElementById("view-zone-detail"),
  config: document.getElementById("view-zone-config"),
};

// Single visibility switch keeps the three containers mutually exclusive without a full router library.
function showView(name) {
  Object.entries(views).forEach(([key, el]) => {
    el.hidden = key !== name;
  });
}

async function openVentBoard() {
  showView("ventboard");
  await renderVentBoardGrid(views.ventboard, { onSelectZone: openZoneDetail });
}

async function openZoneDetail(zoneId) {
  showView("detail");
  await renderZoneDetail(views.detail, zoneId, {
    onBack: openVentBoard,
    onOpenConfig: openZoneConfig,
  });
}

async function openZoneConfig(zoneId) {
  showView("config");
  await renderZoneConfig(views.config, zoneId, {
    onBack: () => openZoneDetail(zoneId),
  });
}

document.querySelector('[data-route="ventboard"]')?.addEventListener("click", openVentBoard);

openVentBoard();
