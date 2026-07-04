// Stage Board: fixed gauge-station summary panel, distinct from the emergency banner
// (which only appears when severe). This always shows the current worst stage plus the
// two headline figures an operator scans first: rate of rise and composite water quality.
const SEVERITY_RANK = { RED: 3, AMBER: 2, GREEN: 1 };
const STAGE_VAR = { RED: "--stage-red", AMBER: "--stage-amber", GREEN: "--stage-green" };

// Which upstream-to-downstream reach last pushed the board to its current worst stage;
// its data category (hydro/quality/meteo) is the tick that gets filled solid.
function worstReach(reachRows) {
  let worst = null;
  let worstRank = 0;
  for (const row of reachRows) {
    const rank = SEVERITY_RANK[row.stage] || 0;
    if (rank > worstRank) {
      worst = row;
      worstRank = rank;
    }
  }
  return worst;
}

function compositeCwqi(waterQualityRows) {
  const values = waterQualityRows.map((row) => row.cwqi).filter((value) => value != null);
  if (values.length === 0) {
    return null;
  }
  const sum = values.reduce((total, value) => total + value, 0);
  return sum / values.length;
}

const QUALITY_BAND_RANK = { POOR: 3, FAIR: 2, GOOD: 1 };

// Each category's own worst-case severity, normalized onto the same 0-3 scale as
// SEVERITY_RANK, so the three real data sources (hydro stage, quality band +
// contamination, meteo pre-storm/pre-warn signals) can be compared on equal footing —
// whichever category is genuinely most severe right now lights its tick, not a fixed default.
function worstCategorySeverity(reachRows, waterQualityRows, meteoRows) {
  const hydroSeverity = reachRows.reduce((max, row) => Math.max(max, SEVERITY_RANK[row.stage] || 0), 0);

  const qualitySeverity = waterQualityRows.reduce((max, row) => {
    let rank = QUALITY_BAND_RANK[row.band] || 0;
    if (row.contaminationSuspected) {
      rank = Math.max(rank, 3);
    }
    return Math.max(max, rank);
  }, 0);

  const meteoSeverity = meteoRows.reduce((max, row) => {
    let rank = 0;
    if (row.preWarnEscalation) {
      rank = 3;
    } else if (row.preStormSignal) {
      rank = 2;
    } else if (row.pressureSlope != null) {
      rank = 1;
    }
    return Math.max(max, rank);
  }, 0);

  return { hydro: hydroSeverity, quality: qualitySeverity, meteo: meteoSeverity };
}

function worstCategory(reachRows, waterQualityRows, meteoRows) {
  const severity = worstCategorySeverity(reachRows, waterQualityRows, meteoRows);
  if (severity.hydro === 0 && severity.quality === 0 && severity.meteo === 0) {
    return null;
  }
  // hydro > quality > meteo priority only breaks genuine ties, it never overrides a higher score.
  let leader = "hydro";
  if (severity.quality > severity[leader]) {
    leader = "quality";
  }
  if (severity.meteo > severity[leader]) {
    leader = "meteo";
  }
  return leader;
}

export function renderStageBoard(reachRows, waterQualityRows, meteoRows) {
  const boardEl = document.getElementById("stageBoard");
  const wordEl = document.getElementById("stageBoardWord");
  const rateEl = document.getElementById("stageBoardRate");
  const wqiEl = document.getElementById("stageBoardWqi");
  const ticksEl = document.getElementById("stageBoardTicks");
  if (!boardEl || !wordEl || !rateEl || !wqiEl || !ticksEl) {
    return;
  }

  const worst = worstReach(reachRows || []);
  const stage = worst ? worst.stage : null;

  wordEl.textContent = stage || "--";
  wordEl.className = `stage-board-word stage-word-${(stage || "unknown").toLowerCase()}`;
  rateEl.textContent = worst && worst.rateOfRise != null ? `${worst.rateOfRise.toFixed(2)} m/sample` : "--";

  const composite = compositeCwqi(waterQualityRows || []);
  wqiEl.textContent = composite != null ? composite.toFixed(0) : "--";

  boardEl.style.setProperty("--stage-board-border", stage ? `var(${STAGE_VAR[stage]})` : "var(--bs-secondary)");

  // Data-category ticks in real upstream flow order; whichever real data source
  // (hydro/quality/meteo) is currently most severe across all reaches is filled,
  // computed fresh each render, not fixed to any one category.
  const leadingStream = worstCategory(reachRows || [], waterQualityRows || [], meteoRows || []);
  for (const tick of ticksEl.querySelectorAll(".stage-board-tick")) {
    tick.classList.toggle("stage-board-tick-active", tick.dataset.stream === leadingStream);
  }
}
