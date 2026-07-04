// Public-warning banner: surfaces only the single most severe active reach, RED outranking
// AMBER, so operators see one unambiguous headline instead of scanning the whole overview.
const SEVERITY_RANK = { RED: 2, AMBER: 1, GREEN: 0 };

const ALERT_CLASS = {
  RED: "alert-danger",
  AMBER: "alert-warning",
};

const STAGE_LABEL = {
  RED: "RED stage",
  AMBER: "AMBER stage",
};

function mostSevereReach(reachRows) {
  let worst = null;
  for (const row of reachRows) {
    const rank = SEVERITY_RANK[row.stage] ?? -1;
    if (rank > 0 && (!worst || rank > SEVERITY_RANK[worst.stage])) {
      worst = row;
    }
  }
  return worst;
}

export function renderEmergencyBanner(bannerEl, reachRows) {
  const worst = mostSevereReach(reachRows || []);

  if (!worst) {
    bannerEl.classList.add("d-none");
    bannerEl.innerHTML = "";
    bannerEl.className = "alert d-none d-flex align-items-center gap-2";
    return;
  }

  bannerEl.className = `alert ${ALERT_CLASS[worst.stage]} d-flex align-items-center gap-2`;
  bannerEl.innerHTML = `
    <span aria-hidden="true">&#9888;</span>
    <span><strong class="reach-id">${worst.reachId}</strong> is at ${STAGE_LABEL[worst.stage]}</span>
  `;
}
