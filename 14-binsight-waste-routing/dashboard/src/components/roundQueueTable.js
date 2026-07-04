const REASON_BADGE_CLASS = {
  HIGH_FILL: "text-bg-warning",
  SAFETY_RISK: "text-bg-danger",
  OVERDUE: "text-bg-secondary",
};

export function renderRoundQueueTable(tbody, workList) {
  tbody.innerHTML = "";
  const items = workList?.items ?? [];

  if (items.length === 0) {
    const row = document.createElement("tr");
    row.id = "round-queue-empty-row";
    row.innerHTML = `<td colspan="4" class="text-body-secondary">No work-list data available yet.</td>`;
    tbody.appendChild(row);
    return;
  }

  for (const item of items) {
    const row = document.createElement("tr");
    row.dataset.binId = item.binId;

    const reasonBadges = (item.dueReasons ?? [])
      .map((reason) => {
        const cls = REASON_BADGE_CLASS[reason] ?? "text-bg-secondary";
        return `<span class="badge ${cls} me-1">${reason}</span>`;
      })
      .join("");

    row.innerHTML = `
      <td>${item.binId}</td>
      <td class="readout-value">${Number(item.priorityScore).toFixed(2)}</td>
      <td>${reasonBadges}</td>
      <td>${item.assignedTruckId ?? "unassigned"}</td>
    `;
    tbody.appendChild(row);
  }
}
