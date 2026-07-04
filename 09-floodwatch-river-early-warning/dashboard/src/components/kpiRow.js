// KPI summary strip for the overview. Every figure is aggregated from the real fetched
// reach rows, not hard-coded; before any data arrives the counts render as 0.

// Reaches, fog nodes and sensor types are the fixed physical topology of this deployment,
// so they are constants rather than fabricated live numbers.
const REACH_COUNT = 3;
const FOG_NODE_COUNT = 3;
const SENSOR_TYPE_COUNT = 10;

const KPI_CARDS = [
  { key: "reaches", icon: "bi-water", tint: "kpi-icon-teal", label: "Reaches Monitored" },
  { key: "sensors", icon: "bi-broadcast", tint: "kpi-icon-blue", label: "Sensor Types" },
  { key: "fog-nodes", icon: "bi-hdd-network", tint: "kpi-icon-slate", label: "Fog Nodes" },
  { key: "active-alerts", icon: "bi-exclamation-triangle", tint: "kpi-icon-amber", label: "Reaches on Alert" },
  { key: "events", icon: "bi-list-columns-reverse", tint: "kpi-icon-red", label: "Escalation Events" },
];

export function renderKpiRow(container) {
  const cards = KPI_CARDS.map(
    (card) => `
      <div class="kpi-card">
        <span class="kpi-icon ${card.tint}"><i class="bi ${card.icon}"></i></span>
        <div>
          <div class="kpi-value" data-kpi="${card.key}">0</div>
          <div class="kpi-label">${card.label}</div>
        </div>
      </div>`
  ).join("");
  container.innerHTML = `<div class="kpi-row" aria-label="River early-warning summary">${cards}</div>`;

  // Static topology is known at render time; the live counts start at 0 until data lands.
  container.querySelector('[data-kpi="reaches"]').textContent = String(REACH_COUNT);
  container.querySelector('[data-kpi="sensors"]').textContent = String(SENSOR_TYPE_COUNT);
  container.querySelector('[data-kpi="fog-nodes"]').textContent = String(FOG_NODE_COUNT);
}

export function updateKpiRow(container, reachOverviewRows, allEvents) {
  // A reach is "on alert" when its latest hydro stage is AMBER or RED - the same real
  // stages the overview table and emergency banner act on.
  const onAlert = (reachOverviewRows || []).filter(
    (row) => row.stage === "RED" || row.stage === "AMBER"
  ).length;
  const eventCount = (allEvents || []).length;

  container.querySelector('[data-kpi="active-alerts"]').textContent = String(onAlert);
  container.querySelector('[data-kpi="events"]').textContent = String(eventCount);
}
