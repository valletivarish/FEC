// KPI summary row for the pond overview. Every value is a genuine aggregate computed from
// the same fetched data the accordion/ledger render from -- never a fabricated number. When
// the backend is unreachable the online/alert counts collapse to 0 on their own.

// 10 real sensor types simulated per pond and 3 real fog nodes (LifeSupportFog, ToxicityFog,
// OpsFog) -- fixed facts of this deployment, shown for context alongside the live counts.
const SENSOR_TYPE_COUNT = 10;
const FOG_NODE_COUNT = 3;

const CARDS = [
  { key: 'ponds', label: 'Ponds Monitored', icon: 'bi-water', tint: 'kpi-icon-blue' },
  { key: 'online', label: 'Ponds Online', icon: 'bi-reception-4', tint: 'kpi-icon-teal' },
  { key: 'sensors', label: 'Sensor Types', icon: 'bi-thermometer-half', tint: 'kpi-icon-blue' },
  { key: 'fog', label: 'Fog Nodes', icon: 'bi-hdd-network', tint: 'kpi-icon-teal' },
  { key: 'alerts', label: 'Active Toxicity Alerts', icon: 'bi-exclamation-octagon', tint: 'kpi-icon-red' },
];

export function renderKpiRow(container) {
  container.innerHTML = `
    <div class="kpi-row" aria-label="Fish-farm summary">
      ${CARDS.map(
        (c) => `
        <div class="kpi-card" data-tint="${c.tint}">
          <div class="kpi-value" data-kpi="${c.key}">0</div>
          <div class="kpi-label"><i class="bi ${c.icon} kpi-icon ${c.tint}"></i>${c.label}</div>
        </div>`
      ).join('')}
    </div>`;
}

// pondBundles: [{ pondId, ok, ... }]; alerts: the flat urgent-toxicity ledger array.
export function updateKpiRow(container, pondBundles, alerts) {
  const pondCount = pondBundles.length;
  const online = pondBundles.filter((b) => b.ok).length;
  const alertCount = Array.isArray(alerts) ? alerts.length : 0;

  const set = (key, value) => {
    const el = container.querySelector(`[data-kpi="${key}"]`);
    if (el) el.textContent = String(value);
  };
  set('ponds', pondCount);
  set('online', online);
  set('sensors', SENSOR_TYPE_COUNT);
  set('fog', FOG_NODE_COUNT);
  set('alerts', alertCount);
}
