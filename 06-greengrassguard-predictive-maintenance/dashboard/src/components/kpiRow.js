// KPI summary strip for the fleet overview. Every value is computed from the real
// fetched diagnosis events, never fabricated — an empty backend shows 0s, not placeholders.
// Rendered as one continuous diagnostic-readout bar (stat groups + dividers), not boxed cards,
// to match this project's workshop/oscilloscope register. Also drives the header status chip
// off the same activeFaults aggregate — no separate fault-count computation.
export function renderKpiRow(container, { assetCount, fogNodeCount, events }) {
  const evts = Array.isArray(events) ? events : [];
  const activeFaults = evts.filter((e) => e.type === 'vibe_fault').length;
  const thermalRunaways = evts.filter(
    (e) => e.type === 'thermal_event' && (e.verdict_tags || []).includes('runaway')
  ).length;
  const diagnosisEvents = evts.length;

  container.innerHTML = `
    <div class="kpi-strip" aria-label="Fleet summary" data-testid="kpi-row">
      <div class="kpi-stat">
        <span class="kpi-stat-icon"><i class="bi bi-hdd-stack"></i></span>
        <div>
          <div class="kpi-value" data-kpi="assets">${assetCount}</div>
          <div class="kpi-label">Assets Monitored</div>
        </div>
      </div>
      <div class="kpi-stat kpi-stat-danger">
        <span class="kpi-stat-icon"><i class="bi bi-exclamation-triangle"></i></span>
        <div>
          <div class="kpi-value" data-kpi="active-faults">${activeFaults}</div>
          <div class="kpi-label">Active Vibe Faults</div>
        </div>
      </div>
      <div class="kpi-stat kpi-stat-warning">
        <span class="kpi-stat-icon"><i class="bi bi-fire"></i></span>
        <div>
          <div class="kpi-value" data-kpi="thermal-runaways">${thermalRunaways}</div>
          <div class="kpi-label">Thermal Runaways</div>
        </div>
      </div>
      <div class="kpi-stat">
        <span class="kpi-stat-icon"><i class="bi bi-diagram-3"></i></span>
        <div>
          <div class="kpi-value" data-kpi="fog-nodes">${fogNodeCount}</div>
          <div class="kpi-label">Fog Nodes</div>
        </div>
      </div>
      <div class="kpi-stat">
        <span class="kpi-stat-icon"><i class="bi bi-clipboard-data"></i></span>
        <div>
          <div class="kpi-value" data-kpi="diagnosis-events">${diagnosisEvents}</div>
          <div class="kpi-label">Diagnosis Events</div>
        </div>
      </div>
    </div>
  `;

  const chip = document.getElementById('header-status-chip');
  if (chip) {
    const isFault = activeFaults > 0;
    chip.textContent = isFault ? `FAULT · ${activeFaults}` : 'NOMINAL';
    chip.dataset.state = isFault ? 'fault' : 'nominal';
    chip.title = isFault
      ? `Overall fleet status: FAULT means ${activeFaults} asset${activeFaults === 1 ? '' : 's'} currently ${activeFaults === 1 ? 'has' : 'have'} an active vibration or thermal fault`
      : 'Overall fleet status: NOMINAL means no assets currently have an active vibration or thermal fault';
  }
}
