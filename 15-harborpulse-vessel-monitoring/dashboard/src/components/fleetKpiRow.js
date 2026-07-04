// KPI summary cards for the fleet console. Values are populated from genuine
// aggregates of the fetched telemetry/alarm feed, never fabricated.
const KPI_CARDS = [
  { key: 'trackedVessels', label: 'Vessels Tracked', icon: 'bi-broadcast-pin', tone: 'blue' },
  { key: 'fogNodes', label: 'Fog Nodes', icon: 'bi-hdd-network', tone: 'green' },
  { key: 'activeAlarms', label: 'Active Alarms', icon: 'bi-shield-exclamation', tone: 'red' },
  { key: 'degradedEngines', label: 'Degraded Engines', icon: 'bi-gear-wide-connected', tone: 'amber' },
  { key: 'roughSeas', label: 'Rough / Severe Seas', icon: 'bi-water', tone: 'amber' },
];

export function renderKpiRow(container) {
  if (!container) return;
  container.innerHTML = `
    <div class="kpi-row" aria-label="Fleet summary">
      ${KPI_CARDS.map((card) => `
        <div class="kpi-card">
          <span class="kpi-icon-badge kpi-icon-${card.tone}"><i class="bi ${card.icon}"></i></span>
          <div>
            <div class="kpi-value" data-kpi="${card.key}">0</div>
            <div class="kpi-label">${card.label}</div>
          </div>
        </div>
      `).join('')}
    </div>
  `;
}

export function updateKpiRow(metrics) {
  KPI_CARDS.forEach((card) => {
    const el = document.querySelector(`[data-kpi="${card.key}"]`);
    if (el) el.textContent = String(metrics[card.key] ?? 0);
  });
}
