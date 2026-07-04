// runaway is the more severe tag (unbounded temperature climb) so it wins the badge color
// when both tags are present on the same event
function badgeForTag(tag) {
  return tag === 'runaway' ? 'text-bg-danger' : 'text-bg-warning';
}

function fmtNum(value) {
  return Number(value).toFixed(3);
}

export function renderThermalEventsTable(container, events) {
  if (!events || events.length === 0) {
    container.innerHTML = `
      <div class="card">
        <div class="card-body">
          <table class="table table-striped table-hover align-middle" data-testid="thermal-events-table">
            <thead>
              <tr>
                <th scope="col">Asset ID</th>
                <th scope="col">Verdict Tags</th>
                <th scope="col">Slope (degC/sample)</th>
                <th scope="col">Deviation (degC)</th>
                <th scope="col">Timestamp</th>
              </tr>
            </thead>
            <tbody></tbody>
          </table>
        </div>
      </div>`;
    return;
  }

  const rows = events.map((evt) => {
    const badges = (evt.verdict_tags || [])
      .map((tag) => `<span class="badge rounded-pill ${badgeForTag(tag)} me-1">${tag}</span>`)
      .join('');
    return `
      <tr data-testid="thermal-event-row" data-asset-id="${evt.asset_id}">
        <td>${evt.asset_id}</td>
        <td>${badges}</td>
        <td>${fmtNum(evt.slope)}</td>
        <td>${fmtNum(evt.deviation)}</td>
        <td>${evt.timestamp}</td>
      </tr>`;
  }).join('');

  container.innerHTML = `
    <div class="card">
      <div class="card-body">
        <table class="table table-striped table-hover align-middle" data-testid="thermal-events-table">
          <thead>
            <tr>
              <th scope="col">Asset ID</th>
              <th scope="col">Verdict Tags</th>
              <th scope="col">Slope (degC/sample)</th>
              <th scope="col">Deviation (degC)</th>
              <th scope="col">Timestamp</th>
            </tr>
          </thead>
          <tbody>${rows}</tbody>
        </table>
      </div>
    </div>`;
}
