// Stage badge class kept as one lookup so unknown/offline reaches never fall through unstyled.
const STAGE_BADGE = {
  GREEN: "text-bg-success",
  AMBER: "text-bg-warning",
  RED: "text-bg-danger",
};

function badgeClassForStage(stage) {
  return STAGE_BADGE[stage] || "text-bg-secondary";
}

// Hand-rolled SVG polyline, not a charting library: back-fills a short trend from the
// current level and rate-of-rise so the reading gets a "hand-plotted hydrograph" look.
function riverLevelSparkline(riverLevel, rateOfRise) {
  if (riverLevel == null) {
    return "";
  }
  const rate = rateOfRise || 0;
  const points = [0, 1, 2, 3, 4].map((step) => riverLevel - rate * (4 - step));
  const min = Math.min(...points);
  const max = Math.max(...points);
  const span = max - min || 1;
  const coords = points
    .map((value, index) => {
      const x = index * 12;
      const y = 20 - ((value - min) / span) * 18 - 1;
      return `${x},${y.toFixed(1)}`;
    })
    .join(" ");
  return `<svg class="river-sparkline" viewBox="0 0 48 20" width="48" height="20" aria-hidden="true">
    <polyline points="${coords}" fill="none" stroke="currentColor" stroke-width="1.5" />
  </svg>`;
}

export function renderReachOverviewTable(tbodyEl, reachRows) {
  tbodyEl.innerHTML = "";

  if (!reachRows || reachRows.length === 0) {
    tbodyEl.innerHTML = `<tr><td colspan="6" class="text-center text-muted">No reach data available</td></tr>`;
    return;
  }

  for (const row of reachRows) {
    const stage = row.stage || "UNKNOWN";
    const blockageBadge = row.blockageSuspected
      ? `<span class="badge rounded-pill text-bg-danger">Blockage?</span>`
      : `<span class="badge rounded-pill text-bg-secondary">Clear</span>`;
    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td class="reach-id">${row.reachId}</td>
      <td class="d-flex align-items-center gap-2">
        <span>${row.riverLevel != null ? row.riverLevel.toFixed(2) : "--"}</span>
        ${riverLevelSparkline(row.riverLevel, row.rateOfRise)}
      </td>
      <td><span class="badge rounded-pill ${badgeClassForStage(stage)}">${stage}</span></td>
      <td>${row.rateOfRise != null ? row.rateOfRise.toFixed(3) : "--"}</td>
      <td>${row.flowRateSlope != null ? row.flowRateSlope.toFixed(2) : "--"}</td>
      <td>${blockageBadge}</td>
    `;
    tbodyEl.appendChild(tr);
  }
}
