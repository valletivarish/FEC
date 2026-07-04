const TRIGGER_BADGE = {
  mad_anomaly: 'text-bg-danger',
  cusum_changepoint: 'text-bg-warning',
  heartbeat: 'text-bg-secondary',
};

// Picks the newest health_event per pump so the row reflects the latest verdict, not just the latest reading.
function latestHealthEventByPump(events) {
  const byPump = new Map();
  for (const event of events) {
    if (event.type !== 'health_event') continue;
    const current = byPump.get(event.pumpId);
    if (!current || new Date(event.timestamp) > new Date(current.timestamp)) {
      byPump.set(event.pumpId, event);
    }
  }
  return byPump;
}

export function renderPumpHealthTable(pumpIds, events) {
  const latestByPump = latestHealthEventByPump(events);

  const rows = pumpIds
    .map((pumpId) => {
      const event = latestByPump.get(pumpId);
      if (!event) {
        return `
          <tr data-pump-id="${pumpId}">
            <td>${pumpId}</td>
            <td class="readout-value">&mdash;</td>
            <td class="readout-value">&mdash;</td>
            <td class="readout-value">&mdash;</td>
            <td class="readout-value">&mdash;</td>
            <td><span class="badge rounded-pill text-bg-success">nominal</span></td>
          </tr>`;
      }
      const badgeClass = TRIGGER_BADGE[event.trigger] || 'text-bg-secondary';
      return `
        <tr data-pump-id="${pumpId}">
          <td>${pumpId}</td>
          <td class="readout-value">${Number(event.vibration).toFixed(2)} mm/s RMS</td>
          <td class="readout-value">${Number(event.bearingTemp).toFixed(1)} &deg;C</td>
          <td class="readout-value">${Number(event.motorCurrent).toFixed(1)} A</td>
          <td class="readout-value">${Number(event.rpm).toFixed(0)} RPM</td>
          <td><span class="badge rounded-pill ${badgeClass}">${event.trigger}</span></td>
        </tr>`;
    })
    .join('');

  return `
    <div class="card readout-panel">
      <div class="card-body">
        <h2 class="h5 card-title">Pump Health</h2>
        <div class="table-responsive">
          <table class="table table-hover align-middle mb-0" data-testid="pump-health-table">
            <thead>
              <tr>
                <th scope="col">Pump</th>
                <th scope="col">Vibration (mm/s RMS)</th>
                <th scope="col">Bearing Temp (&deg;C)</th>
                <th scope="col">Motor Current (A)</th>
                <th scope="col">RPM</th>
                <th scope="col">Status</th>
              </tr>
            </thead>
            <tbody>${rows}</tbody>
          </table>
        </div>
      </div>
    </div>`;
}
