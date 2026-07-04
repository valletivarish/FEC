const BAND_BADGE = {
  GOOD: "text-bg-success",
  FAIR: "text-bg-warning",
  POOR: "text-bg-danger",
};

function badgeClassForBand(band) {
  return BAND_BADGE[band] || "text-bg-secondary";
}

export function renderWaterQualityTable(tbodyEl, qualityRows) {
  tbodyEl.innerHTML = "";

  if (!qualityRows || qualityRows.length === 0) {
    tbodyEl.innerHTML = `<tr><td colspan="4" class="text-center text-muted">No water quality data available</td></tr>`;
    return;
  }

  for (const row of qualityRows) {
    const band = row.band || "UNKNOWN";
    const contaminationBadge = row.contaminationSuspected
      ? `<span class="badge rounded-pill text-bg-danger">Suspected</span>`
      : `<span class="badge rounded-pill text-bg-success">Clear</span>`;
    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td class="reach-id">${row.reachId}</td>
      <td>${row.cwqi != null ? row.cwqi.toFixed(1) : "--"}</td>
      <td><span class="badge rounded-pill ${badgeClassForBand(band)}">${band}</span></td>
      <td>${contaminationBadge}</td>
    `;
    tbodyEl.appendChild(tr);
  }
}
