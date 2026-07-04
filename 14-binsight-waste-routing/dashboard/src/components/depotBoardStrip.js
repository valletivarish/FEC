// KPI summary cards derive straight from the same depot-status payload the other panels use —
// no separate fetch, keeps the row trivially consistent with what's on screen below it.
const KPI_DEFS = [
  { key: "binsDue", label: "Bins Due", icon: "bi-trash", iconClass: "kpi-icon-amber" },
  { key: "criticalFireRisk", label: "Critical Fire-Risk", icon: "bi-fire", iconClass: "kpi-icon-red" },
  { key: "watchFireRisk", label: "Watch Fire-Risk", icon: "bi-exclamation-triangle", iconClass: "kpi-icon-amber" },
  { key: "activeTrucks", label: "Active Trucks", icon: "bi-truck", iconClass: "kpi-icon-slate" },
  { key: "fogNodes", label: "Fog Nodes", icon: "bi-hdd-network", iconClass: "kpi-icon-green" },
];

export function renderDepotBoardStrip(container, stats) {
  const cards = KPI_DEFS.map((def, index) => {
    const value = stats[def.key] ?? 0;
    const isHero = index === 0;
    return `
      <div class="kpi-card${isHero ? " kpi-card-hero" : ""}">
        <span class="kpi-icon ${def.iconClass}"><i class="bi ${def.icon}"></i></span>
        <div>
          <div class="kpi-value stat-value" data-kpi="${def.key}">${value}</div>
          <div class="kpi-label">${def.label}</div>
        </div>
      </div>
    `;
  }).join("");
  container.innerHTML = `<div class="kpi-row" aria-label="Depot summary">${cards}</div>`;
}

export function computeDepotStats(depotStatus, knownTruckIds) {
  const fireRiskByBin = latestRiskStatusByBin(depotStatus.fireRiskEvents ?? []);
  const workListItems = depotStatus.latestWorkList?.items ?? [];

  const criticalFireRisk = Object.values(fireRiskByBin).filter((s) => s === "CRITICAL").length;
  const watchFireRisk = Object.values(fireRiskByBin).filter((s) => s === "WATCH").length;

  return {
    binsDue: workListItems.length,
    criticalFireRisk,
    watchFireRisk,
    activeTrucks: knownTruckIds.length,
    // BinClusterNode, BinSafetyNode, FleetNode — the three fog nodes feeding this depot board.
    fogNodes: 3,
  };
}

export function latestRiskStatusByBin(fireRiskEvents) {
  const latest = {};
  const seenAt = {};
  for (const event of fireRiskEvents) {
    const ts = event.timestamp ?? "";
    if (!seenAt[event.binId] || ts > seenAt[event.binId]) {
      latest[event.binId] = event.riskStatus;
      seenAt[event.binId] = ts;
    }
  }
  return latest;
}
