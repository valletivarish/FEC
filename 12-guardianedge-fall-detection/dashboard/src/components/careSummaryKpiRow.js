// Top-of-overview KPI row. Every number is aggregated from the same fetched
// resident/history data the panels below render — no fabricated values.
export function renderCareSummaryKpiRow(container) {
  container.innerHTML = `
    <div class="kpi-row" aria-label="Care summary">
      <div class="kpi-card kpi-card-blue">
        <span class="kpi-icon kpi-icon-blue"><i class="bi bi-people"></i></span>
        <div>
          <div class="kpi-value" data-testid="kpi-residents" data-kpi="residents">0</div>
          <div class="kpi-label">Residents Monitored</div>
        </div>
      </div>
      <div class="kpi-card kpi-card-red">
        <span class="kpi-icon kpi-icon-red"><i class="bi bi-exclamation-octagon"></i></span>
        <div>
          <div class="kpi-value" data-testid="kpi-falls" data-kpi="falls">0</div>
          <div class="kpi-label">Confirmed Falls</div>
        </div>
      </div>
      <div class="kpi-card kpi-card-amber">
        <span class="kpi-icon kpi-icon-amber"><i class="bi bi-heart-pulse"></i></span>
        <div>
          <div class="kpi-value" data-testid="kpi-critical" data-kpi="critical">0</div>
          <div class="kpi-label">Critical Residents</div>
        </div>
      </div>
      <div class="kpi-card kpi-card-teal">
        <span class="kpi-icon kpi-icon-teal"><i class="bi bi-hourglass-split"></i></span>
        <div>
          <div class="kpi-value" data-testid="kpi-inactivity" data-kpi="inactivity">0</div>
          <div class="kpi-label">Inactivity Alerts</div>
        </div>
      </div>
    </div>
  `;
}

export function updateCareSummaryKpiRow(container, metrics) {
  container.querySelector('[data-kpi="residents"]').textContent = String(metrics.residentCount);
  container.querySelector('[data-kpi="falls"]').textContent = String(metrics.confirmedFalls);
  container.querySelector('[data-kpi="critical"]').textContent = String(metrics.criticalResidents);
  container.querySelector('[data-kpi="inactivity"]').textContent = String(metrics.inactivityAlerts);
}
