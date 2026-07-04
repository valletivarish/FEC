function badgeForBoolean(value, activeText, inactiveText) {
  return value
    ? `<span class="badge rounded-pill text-bg-warning">${activeText}</span>`
    : `<span class="badge rounded-pill text-bg-success">${inactiveText}</span>`;
}

export function renderMeteoWatchTable(tbodyEl, meteoRows) {
  tbodyEl.innerHTML = "";

  if (!meteoRows || meteoRows.length === 0) {
    tbodyEl.innerHTML = `<tr><td colspan="4" class="text-center text-muted">No meteo data available</td></tr>`;
    return;
  }

  for (const row of meteoRows) {
    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td class="reach-id">${row.reachId}</td>
      <td>${row.pressureSlope != null ? row.pressureSlope.toFixed(3) : "--"}</td>
      <td>${badgeForBoolean(row.preStormSignal, "Active", "Clear")}</td>
      <td>${row.preWarnEscalation ? `<span class="badge rounded-pill text-bg-danger">Escalated</span>` : `<span class="badge rounded-pill text-bg-secondary">None</span>`}</td>
    `;
    tbodyEl.appendChild(tr);
  }
}
