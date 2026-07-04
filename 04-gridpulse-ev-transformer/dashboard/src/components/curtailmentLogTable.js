// Bootstrap table, most recent event first — rung severity carries semantic meaning via badge color
export class CurtailmentLogTable {
  constructor(container) {
    this.container = container;
    this.container.innerHTML = `
      <div class="card">
        <div class="card-body">
          <table class="table table-striped table-hover align-middle mb-0" data-testid="curtailment-log-table">
            <thead>
              <tr>
                <th scope="col">Timestamp</th>
                <th scope="col">Rung</th>
                <th scope="col">Reason</th>
                <th scope="col">Shed Bay</th>
              </tr>
            </thead>
            <tbody data-testid="curtailment-log-tbody"></tbody>
          </table>
        </div>
      </div>
    `;
    this.tbody = this.container.querySelector('[data-testid="curtailment-log-tbody"]');
  }

  update(events) {
    const rows = Array.isArray(events) ? events : [];
    if (rows.length === 0) {
      this.tbody.innerHTML = '<tr><td colspan="4" class="text-body-secondary">No curtailment events</td></tr>';
      return;
    }

    const sorted = [...rows].sort((a, b) => (b.timestamp ?? '').localeCompare(a.timestamp ?? ''));

    this.tbody.innerHTML = sorted
      .map((event) => {
        return `
          <tr>
            <td>${event.timestamp ?? '—'}</td>
            <td><span class="badge rounded-pill ${badgeClass(event.rung)}">${event.rungLabel ?? event.rung ?? '—'}</span></td>
            <td>${event.reason ?? '—'}</td>
            <td>${event.shedBayId ?? '—'}</td>
          </tr>
        `;
      })
      .join('');
  }
}

function badgeClass(rung) {
  if (rung === 2 || rung === 3) return 'text-bg-danger';
  if (rung === 1) return 'text-bg-warning';
  if (rung === 0) return 'text-bg-success';
  return 'text-bg-secondary';
}
