import { renderFleetManifestView } from "./views/FleetManifestView.js";
import { renderShipmentLaneView } from "./views/ShipmentLaneView.js";
import { renderExcursionLedgerView } from "./views/ExcursionLedgerView.js";

const views = {
  fleet: document.getElementById("fleet-view"),
  lane: document.getElementById("lane-view"),
  ledger: document.getElementById("ledger-view"),
};
const navButtons = document.querySelectorAll(".nav-link");
const consoleClock = document.querySelector("[data-testid='console-clock']");
const consoleFleetStatus = document.querySelector("[data-testid='console-fleet-status']");

// Tracks the shipment currently drilled into so lane/ledger nav clicks can re-render it.
let activeShipmentId = null;

function showView(name) {
  Object.entries(views).forEach(([key, el]) => {
    el.classList.toggle("d-none", key !== name);
  });
  navButtons.forEach((button) => {
    button.classList.toggle("is-active", button.dataset.view === name);
  });
}

function setShipmentNavEnabled(enabled) {
  navButtons.forEach((button) => {
    if (button.dataset.view === "lane" || button.dataset.view === "ledger") {
      button.disabled = !enabled;
    }
  });
}

async function openShipment(shipmentId) {
  activeShipmentId = shipmentId;
  setShipmentNavEnabled(true);
  showView("lane");
  await renderShipmentLaneView(views.lane, shipmentId, () => {
    showView("fleet");
  });
}

navButtons.forEach((button) => {
  button.addEventListener("click", async () => {
    const view = button.dataset.view;
    if (view === "fleet") {
      showView("fleet");
    } else if (view === "lane" && activeShipmentId) {
      await openShipment(activeShipmentId);
    } else if (view === "ledger" && activeShipmentId) {
      showView("ledger");
      await renderExcursionLedgerView(views.ledger, activeShipmentId);
    }
  });
});

// Live UTC clock in the header meta strip.
function tickClock() {
  if (!consoleClock) return;
  consoleClock.textContent = `${new Date().toISOString().slice(11, 19)}Z`;
}
tickClock();
setInterval(tickClock, 1000);

// Counts real BREACH-severity manifest rows in the DOM to drive the header fleet-status readout.
function updateFleetStatusReadout() {
  if (!consoleFleetStatus) return;
  const rows = document.querySelectorAll("[data-testid='manifest-row']");
  const breachCount = Array.from(rows).filter((row) => row.dataset.severity === "BREACH").length;
  if (breachCount > 0) {
    consoleFleetStatus.textContent = `Fleet: ${breachCount} in breach`;
    consoleFleetStatus.dataset.severity = "BREACH";
  } else {
    consoleFleetStatus.textContent = "Fleet: nominal";
    consoleFleetStatus.dataset.severity = "OK";
  }
}

const manifestObserver = new MutationObserver(updateFleetStatusReadout);
manifestObserver.observe(views.fleet, { childList: true, subtree: true });

renderFleetManifestView(views.fleet, openShipment);
showView("fleet");
