// Bootstrap table, one row per bay — connector state carries semantic meaning via badge color
export class BayRosterTable {
  constructor(container) {
    this.container = container;
    this.container.innerHTML = `
      <div class="card">
        <div class="card-body">
          <table class="table table-striped table-hover align-middle mb-0" data-testid="bay-roster-table">
            <thead>
              <tr>
                <th scope="col">Bay</th>
                <th scope="col">Connector</th>
                <th scope="col" class="text-end" title="State of charge">EV Charge %</th>
                <th scope="col" class="text-end">Setpoint A</th>
              </tr>
            </thead>
            <tbody data-testid="bay-roster-tbody"></tbody>
          </table>
        </div>
      </div>
    `;
    this.tbody = this.container.querySelector('[data-testid="bay-roster-tbody"]');
  }

  update(bays) {
    const rows = Array.isArray(bays) ? bays : [];
    if (rows.length === 0) {
      this.tbody.innerHTML = '<tr><td colspan="4" class="text-body-secondary">No bay data</td></tr>';
      return;
    }

    this.tbody.innerHTML = rows
      .map((bay) => {
        const state = bay.connectorState ?? 'unplugged';
        const soc = formatNumber(bay.evSoc);
        const setpoint = formatNumber(bay.setpointAmps);
        return `
          <tr data-testid="bay-row-${bay.bayId}">
            <td>${bay.bayId ?? '—'}</td>
            <td><span class="badge rounded-pill ${badgeClass(state)}">${state}</span></td>
            <td class="text-end">${soc}</td>
            <td class="text-end">${setpoint}</td>
          </tr>
        `;
      })
      .join('');
  }
}

function badgeClass(state) {
  switch (state) {
    case 'charging':
      return 'text-bg-success';
    case 'fault':
      return 'text-bg-danger';
    case 'plugged':
      return 'text-bg-warning';
    case 'unplugged':
    default:
      return 'text-bg-secondary';
  }
}

function formatNumber(value) {
  return typeof value === 'number' && Number.isFinite(value) ? value.toFixed(1) : '—';
}
