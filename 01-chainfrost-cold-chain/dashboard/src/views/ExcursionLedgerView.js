import { getExcursionHistory } from "../api/chainfrostApiClient.js";

const SEVERITY_OPTIONS = ["ALL", "INFO", "WARN", "BREACH"];

const SEVERITY_BADGE_CLASS = {
  INFO: "text-bg-secondary",
  WARN: "text-bg-warning",
  BREACH: "text-bg-danger",
};

// Chronological table of FogEvent-shaped excursion records, filterable client-side.
export async function renderExcursionLedgerView(container, shipmentId) {
  container.innerHTML = `
    <div class="ledger-header d-flex flex-wrap align-items-center gap-2 mb-3">
      <div class="w-100">
        <h1 class="h4 mb-0">Excursion Ledger</h1>
        <p class="text-muted mb-0">Shipment <span class="font-monospace">${escapeHtml(shipmentId)}</span></p>
      </div>
      <label class="col-form-label" for="severity-filter">Severity</label>
      <select id="severity-filter" class="form-select form-select-sm w-auto ms-auto" data-testid="severity-filter">
        ${SEVERITY_OPTIONS.map((option) => `<option value="${option}">${option}</option>`).join("")}
      </select>
    </div>
    <div class="card">
      <div class="card-body">
        <div class="table-responsive">
          <table class="table table-striped table-hover align-middle" data-testid="ledger-table">
            <thead>
              <tr>
                <th>Timestamp</th>
                <th>Truck</th>
                <th>Event Type</th>
                <th>Severity</th>
                <th>Detail</th>
              </tr>
            </thead>
            <tbody data-testid="ledger-tbody">
              <tr><td colspan="5" class="text-muted">Loading excursion history&hellip;</td></tr>
            </tbody>
          </table>
        </div>
      </div>
    </div>
  `;

  const tbody = container.querySelector("[data-testid='ledger-tbody']");
  const select = container.querySelector("#severity-filter");

  let events = [];
  try {
    const history = await getExcursionHistory(shipmentId);
    events = Array.isArray(history?.events) ? history.events : Array.isArray(history) ? history : [];
    events.sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));
  } catch (error) {
    tbody.innerHTML = `<tr><td colspan="5" class="text-danger" data-testid="ledger-error">No live data — start the local stack to see readings. (${escapeHtml(error.message)})</td></tr>`;
    return;
  }

  const renderRows = (severity) => {
    const filtered = severity === "ALL" ? events : events.filter((event) => event.severity === severity);
    if (filtered.length === 0) {
      tbody.innerHTML = `<tr><td colspan="5" class="text-muted">No excursions for filter "${escapeHtml(severity)}".</td></tr>`;
      return;
    }
    tbody.innerHTML = filtered
      .map((event) => {
        const severityLabel = event.severity ?? "INFO";
        const badgeClass = SEVERITY_BADGE_CLASS[severityLabel] ?? "text-bg-secondary";
        return `
        <tr class="ledger-row" data-testid="ledger-row" data-severity="${escapeHtml(severityLabel)}">
          <td class="font-monospace">${escapeHtml(formatTimestamp(event.timestamp))}</td>
          <td class="font-monospace">${escapeHtml(event.truckId ?? "--")}</td>
          <td>${escapeHtml(event.eventType ?? "--")}</td>
          <td><span class="badge ${badgeClass}">${escapeHtml(severityLabel)}</span></td>
          <td>${escapeHtml(formatPayload(event.payload))}</td>
        </tr>`;
      })
      .join("");
  };

  select.addEventListener("change", () => renderRows(select.value));
  renderRows("ALL");
}

function formatTimestamp(value) {
  if (!value) return "--";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toISOString().replace("T", " ").replace("Z", "Z");
}

function formatPayload(payload) {
  if (!payload || typeof payload !== "object") return "--";
  return Object.entries(payload)
    .map(([key, value]) => `${key}=${value}`)
    .join(", ");
}

function escapeHtml(value) {
  const div = document.createElement("div");
  div.textContent = value ?? "";
  return div.innerHTML;
}
