// Picks the newest hydraulics_event per pump; efficiency is only meaningful as a current snapshot.
function latestHydraulicsEventByPump(events) {
  const byPump = new Map();
  for (const event of events) {
    if (event.type !== 'hydraulics_event') continue;
    const current = byPump.get(event.pumpId);
    if (!current || new Date(event.timestamp) > new Date(current.timestamp)) {
      byPump.set(event.pumpId, event);
    }
  }
  return byPump;
}

export function renderHydraulicEfficiencyTable(pumpIds, events) {
  const latestByPump = latestHydraulicsEventByPump(events);

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
            <td><span class="badge rounded-pill text-bg-success">nominal</span></td>
          </tr>`;
      }
      const badgeClass = event.severity === 'CRITICAL' ? 'text-bg-danger' : 'text-bg-warning';
      return `
        <tr data-pump-id="${pumpId}">
          <td>${pumpId}</td>
          <td class="readout-value">${(Number(event.efficiency) * 100).toFixed(1)}%</td>
          <td class="readout-value">${(Number(event.predictedEfficiency) * 100).toFixed(1)}%</td>
          <td class="readout-value">${Number(event.deviationPercentagePoints).toFixed(1)} pp</td>
          <td><span class="badge rounded-pill ${badgeClass}">${event.severity}</span></td>
        </tr>`;
    })
    .join('');

  return `
    <div class="card readout-panel">
      <div class="card-body">
        <h2 class="h5 card-title">Hydraulic Efficiency</h2>
        <div class="table-responsive">
          <table class="table table-hover align-middle mb-0" data-testid="hydraulic-efficiency-table">
            <thead>
              <tr>
                <th scope="col">Pump</th>
                <th scope="col">Efficiency</th>
                <th scope="col">Predicted Efficiency</th>
                <th scope="col">Deviation (pp)</th>
                <th scope="col">Severity</th>
              </tr>
            </thead>
            <tbody>${rows}</tbody>
          </table>
        </div>
      </div>
    </div>`;
}
