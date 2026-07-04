import { latestRiskStatusByBin } from "./depotBoardStrip.js";

const RISK_TILE_CLASS = {
  NORMAL: "risk-tile-normal",
  WATCH: "risk-tile-watch",
  CRITICAL: "risk-tile-critical",
};

// fill % and data-quality flag come from the work-list items (fog-computed, already
// cross-referenced) rather than re-deriving them from raw cluster verdicts here.
function buildTileModels(knownBinIds, depotStatus) {
  const riskByBin = latestRiskStatusByBin(depotStatus.fireRiskEvents ?? []);
  const workListItems = depotStatus.latestWorkList?.items ?? [];
  const workListByBin = Object.fromEntries(workListItems.map((item) => [item.binId, item]));
  const fillByBin = latestFillPctByBin(depotStatus.clusterVerdicts ?? []);

  return knownBinIds.map((binId) => {
    const workListItem = workListByBin[binId];
    const riskStatus = riskByBin[binId] ?? "NORMAL";
    const fillLevelPct = fillByBin[binId];
    return {
      binId,
      riskStatus,
      fillLevelPct,
      dataQualityFlag: workListItem?.dataQualityFlag ?? null,
    };
  });
}

const DATA_QUALITY_FLAG_EXPLANATION = {
  INCONSISTENT: "Data quality flag: bin weight doesn't match the expected weight for this fill level",
  POSSIBLE_FALSE_FULL: "Data quality flag: fill sensor reads high but bin weight is too low to match",
};

function dataQualityFlagTitle(flag) {
  return DATA_QUALITY_FLAG_EXPLANATION[flag] ?? `Data quality flag: ${flag}`;
}

function latestFillPctByBin(clusterVerdicts) {
  const latest = {};
  const seenAt = {};
  for (const verdict of clusterVerdicts) {
    const ts = verdict.timestamp ?? "";
    if (!seenAt[verdict.binId] || ts > seenAt[verdict.binId]) {
      latest[verdict.binId] = verdict.fillLevelPct;
      seenAt[verdict.binId] = ts;
    }
  }
  return latest;
}

export function renderBinRiskGrid(container, knownBinIds, depotStatus) {
  container.innerHTML = "";
  const tiles = buildTileModels(knownBinIds, depotStatus);

  for (const tile of tiles) {
    const tileClass = RISK_TILE_CLASS[tile.riskStatus] ?? RISK_TILE_CLASS.NORMAL;
    const fillPctNum = Number(tile.fillLevelPct);
    const fillText = Number.isFinite(fillPctNum) ? `${fillPctNum.toFixed(0)}% full` : "fill unknown";
    const flagText = tile.dataQualityFlag ? ` &middot; ${tile.dataQualityFlag}` : "";
    // violet outline ring answers "can I trust this reading" independently of the
    // bracket-pulse fill/color, which answers "is this urgent" — both can be true at once.
    const flaggedClass = tile.dataQualityFlag ? "risk-tile-flagged" : "";

    const el = document.createElement("div");
    el.className = `risk-tile ${tileClass} ${flaggedClass}`.trim();
    el.dataset.binId = tile.binId;
    el.dataset.riskStatus = tile.riskStatus;
    if (tile.dataQualityFlag) {
      el.title = dataQualityFlagTitle(tile.dataQualityFlag);
    }
    el.innerHTML = `
      <div class="risk-tile-id">${tile.binId}</div>
      <div class="risk-tile-sub">${fillText}${flagText}</div>
    `;
    container.appendChild(el);
  }
}
