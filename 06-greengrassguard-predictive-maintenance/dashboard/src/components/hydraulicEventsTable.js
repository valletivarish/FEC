function badgeForCavitation(suspected) {
  return suspected ? 'text-bg-danger' : 'text-bg-success';
}

function fmtNum(value) {
  return Number(value).toFixed(3);
}

export function renderHydraulicEventsTable(container, events) {
  if (!events || events.length === 0) {
    container.innerHTML = `
      <div class="card">
        <div class="card-body">
          <table class="table table-striped table-hover align-middle" data-testid="hydraulic-events-table">
            <thead>
              <tr>
                <th scope="col">Asset ID</th>
                <th scope="col">Efficiency</th>
                <th scope="col">Cavitation Suspected</th>
                <th scope="col">Flow CV</th>
                <th scope="col">Pressure (bar)</th>
                <th scope="col">Timestamp</th>
              </tr>
            </thead>
            <tbody></tbody>
          </table>
        </div>
      </div>`;
    return;
  }

  const rows = events.map((evt) => `
    <tr data-testid="hydraulic-event-row" data-asset-id="${evt.asset_id}">
      <td>${evt.asset_id}</td>
      <td>${fmtNum(evt.efficiency)}</td>
      <td><span class="badge rounded-pill ${badgeForCavitation(evt.cavitation_suspected)}">${evt.cavitation_suspected ? 'Suspected' : 'Clear'}</span></td>
      <td>${fmtNum(evt.flow_cv)}</td>
      <td>${fmtNum(evt.pressure)}</td>
      <td>${evt.timestamp}</td>
    </tr>`).join('');

  container.innerHTML = `
    <div class="card">
      <div class="card-body">
        <table class="table table-striped table-hover align-middle" data-testid="hydraulic-events-table">
          <thead>
            <tr>
              <th scope="col">Asset ID</th>
              <th scope="col">Efficiency</th>
              <th scope="col">Cavitation Suspected</th>
              <th scope="col">Flow CV</th>
              <th scope="col">Pressure (bar)</th>
              <th scope="col">Timestamp</th>
            </tr>
          </thead>
          <tbody>${rows}</tbody>
        </table>
      </div>
    </div>`;
}
