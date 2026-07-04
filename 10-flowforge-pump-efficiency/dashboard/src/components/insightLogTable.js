const TYPE_LABEL = {
  health_event: 'Health',
  hydraulics_event: 'Hydraulics',
  integrity_event: 'Integrity',
};

// A single event carries different "status" fields depending on its type
// (trigger, severity, or state) — this normalizes them to one badge per row.
function statusForEvent(event) {
  if (event.type === 'health_event') return event.trigger;
  if (event.type === 'hydraulics_event') return event.severity;
  if (event.type === 'integrity_event') return event.state;
  return 'unknown';
}

const STATUS_BADGE = {
  mad_anomaly: 'text-bg-danger',
  cusum_changepoint: 'text-bg-warning',
  heartbeat: 'text-bg-secondary',
  CRITICAL: 'text-bg-danger',
  WARNING: 'text-bg-warning',
  LEAK_OK: 'text-bg-success',
  LEAK_WATCH: 'text-bg-warning',
  LEAK_CRITICAL: 'text-bg-danger',
};

export function renderInsightLogTable(events) {
  const sorted = [...events].sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));

  const rows = sorted
    .map((event) => {
      const status = statusForEvent(event);
      const badgeClass = STATUS_BADGE[status] || 'text-bg-secondary';
      return `
        <tr>
          <td class="readout-value">${new Date(event.timestamp).toLocaleString()}</td>
          <td>${event.pumpId}</td>
          <td>${TYPE_LABEL[event.type] || event.type}</td>
          <td><span class="badge rounded-pill ${badgeClass}">${status}</span></td>
        </tr>`;
    })
    .join('');

  return `
    <div class="card readout-panel">
      <div class="card-body">
        <h2 class="h5 card-title">Insight Log</h2>
        <div class="table-responsive">
          <table class="table table-hover align-middle mb-0" data-testid="insight-log-table">
            <thead>
              <tr>
                <th scope="col">Timestamp</th>
                <th scope="col">Pump</th>
                <th scope="col">Node</th>
                <th scope="col">Status</th>
              </tr>
            </thead>
            <tbody>${rows}</tbody>
          </table>
        </div>
      </div>
    </div>`;
}
