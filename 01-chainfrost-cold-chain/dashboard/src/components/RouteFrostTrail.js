// Plain waypoint table so dispatch can scan route deviation as data, not a map graphic.
export function renderRouteFrostTrail({ points = [] } = {}) {
  const wrapper = document.createElement("div");
  wrapper.className = "frost-trail";

  if (points.length === 0) {
    wrapper.innerHTML = `<p class="text-muted">Awaiting telematics fix.</p>`;
    return wrapper;
  }

  const hasTimestamp = points.some((p) => p.timestamp);
  const hasSpeed = points.some((p) => typeof p.speedKph === "number");

  const table = document.createElement("table");
  table.className = "table table-striped table-hover align-middle";
  table.setAttribute("data-testid", "route-waypoint-table");
  table.innerHTML = `
    <thead>
      <tr>
        ${hasTimestamp ? "<th>Timestamp</th>" : "<th>#</th>"}
        <th>Lat</th>
        <th>Lon</th>
        ${hasSpeed ? "<th>Speed (km/h)</th>" : ""}
      </tr>
    </thead>
    <tbody>
      ${points
        .map(
          (point, index) => `
        <tr>
          <td>${escapeHtml(hasTimestamp ? point.timestamp : String(index + 1))}</td>
          <td>${formatCoord(point.lat)}</td>
          <td>${formatCoord(point.lng)}</td>
          ${hasSpeed ? `<td>${formatSpeed(point.speedKph)}</td>` : ""}
        </tr>`
        )
        .join("")}
    </tbody>
  `;

  wrapper.appendChild(table);
  return wrapper;
}

function formatCoord(value) {
  return typeof value === "number" ? value.toFixed(4) : "--";
}

function formatSpeed(value) {
  return typeof value === "number" ? value.toFixed(0) : "--";
}

function escapeHtml(value) {
  const div = document.createElement("div");
  div.textContent = value ?? "";
  return div.innerHTML;
}
