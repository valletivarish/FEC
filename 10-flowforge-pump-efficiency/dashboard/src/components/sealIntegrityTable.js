const STATE_BADGE = {
  LEAK_OK: 'text-bg-success',
  LEAK_WATCH: 'text-bg-warning',
  LEAK_CRITICAL: 'text-bg-danger',
};

// Picks the newest integrity_event per pump; the state machine only dispatches on transitions
// so the latest event IS the current state.
function latestIntegrityEventByPump(events) {
  const byPump = new Map();
  for (const event of events) {
    if (event.type !== 'integrity_event') continue;
    const current = byPump.get(event.pumpId);
    if (!current || new Date(event.timestamp) > new Date(current.timestamp)) {
      byPump.set(event.pumpId, event);
    }
  }
  return byPump;
}

export function renderSealIntegrityTable(pumpIds, events) {
  const latestByPump = latestIntegrityEventByPump(events);

  const rows = pumpIds
    .map((pumpId) => {
      const event = latestByPump.get(pumpId);
      if (!event) {
        return `
          <tr data-pump-id="${pumpId}">
            <td>${pumpId}</td>
            <td><span class="badge rounded-pill text-bg-success">LEAK_OK</span></td>
            <td class="readout-value">&mdash;</td>
            <td class="readout-value">&mdash;</td>
            <td class="readout-value">&mdash;</td>
          </tr>`;
      }
      const badgeClass = STATE_BADGE[event.state] || 'text-bg-secondary';
      const turbidityReadout = event.turbidity == null ? '&mdash;' : `${Number(event.turbidity).toFixed(1)} NTU`;
      return `
        <tr data-pump-id="${pumpId}">
          <td>${pumpId}</td>
          <td><span class="badge rounded-pill ${badgeClass}">${event.state}</span></td>
          <td class="readout-value">${Number(event.sealLeak).toFixed(1)} mL/min</td>
          <td class="readout-value">${Number(event.trendSlope).toFixed(3)} mL/min/sample</td>
          <td class="readout-value">${turbidityReadout}</td>
        </tr>`;
    })
    .join('');

  return `
    <div class="card readout-panel">
      <div class="card-body">
        <h2 class="h5 card-title">Seal Integrity</h2>
        <div class="table-responsive">
          <table class="table table-hover align-middle mb-0" data-testid="seal-integrity-table">
            <thead>
              <tr>
                <th scope="col">Pump</th>
                <th scope="col">State</th>
                <th scope="col">Seal Leak (mL/min)</th>
                <th scope="col">Trend Slope</th>
                <th scope="col">Turbidity (NTU)</th>
              </tr>
            </thead>
            <tbody>${rows}</tbody>
          </table>
        </div>
      </div>
    </div>`;
}
