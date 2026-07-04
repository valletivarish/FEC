function fmtNum(value) {
  return Number(value).toFixed(3);
}

// anomaly scores are typically 0-5ish in this pipeline's fault bands; normalize to a 0-100
// progress width so the bar always reads meaningfully instead of clipping or looking empty
function anomalyProgressPercent(score) {
  return Math.max(4, Math.min(100, Math.round((Number(score) / 5) * 100)));
}

function anomalyVariant(score) {
  const value = Number(score);
  if (value >= 3.5) return 'bg-danger';
  if (value >= 1.5) return 'bg-warning';
  return 'bg-success';
}

// mirrors the danger/warning convention used for verdict-tag badges elsewhere in this dashboard
function badgeForSeverity(severity) {
  return severity === 'high' ? 'text-bg-danger' : 'text-bg-warning';
}

// only the most recent vibe_fault event is shown — the card is a diagnostic snapshot, not a log
export function renderVibeFaultDetail(container, vibeFaultEvent) {
  if (!vibeFaultEvent) {
    container.innerHTML = `
      <div class="card" data-testid="vibe-fault-card">
        <div class="card-body">
          <h5 class="card-title">No vibe fault reported</h5>
          <p class="card-text text-body-secondary">No live data — start the local stack to see readings.</p>
        </div>
      </div>`;
    return;
  }

  const bandRows = (vibeFaultEvent.fault_bands || []).map((band) => `
    <tr data-testid="fault-band-row">
      <td>${band.band}</td>
      <td>${fmtNum(band.energy)}</td>
      <td>
        <div class="d-flex align-items-center gap-2">
          <div class="progress flex-grow-1" role="progressbar" aria-label="${band.band} anomaly score"
               aria-valuenow="${fmtNum(band.anomaly_score)}" aria-valuemin="0" aria-valuemax="5"
               data-testid="anomaly-score-progress" style="height: 0.85rem; min-width: 6rem;">
            <div class="progress-bar ${anomalyVariant(band.anomaly_score)}" style="width: ${anomalyProgressPercent(band.anomaly_score)}%"></div>
          </div>
          <span class="small text-body-secondary">${fmtNum(band.anomaly_score)}</span>
        </div>
      </td>
    </tr>`).join('');

  const severity = vibeFaultEvent.severity;
  const severityBadge = severity
    ? `<span class="badge rounded-pill ${badgeForSeverity(severity)}" data-testid="vibe-fault-severity">${severity.toUpperCase()}</span>`
    : '';
  // corroboration is a plain text note, not another badge — keeps the header from turning into a badge wall
  const corroborationNote = vibeFaultEvent.acoustic_corroborated
    ? '<span class="small text-body-secondary" data-testid="acoustic-corroborated-note">Acoustic-corroborated</span>'
    : '';

  container.innerHTML = `
    <div class="card" data-testid="vibe-fault-card">
      <div class="card-body">
        <h5 class="card-title">
          ${vibeFaultEvent.asset_id}
          <span class="badge rounded-pill text-bg-danger">Fault</span>
          ${severityBadge}
        </h5>
        <h6 class="card-subtitle mb-2 text-body-secondary">${vibeFaultEvent.metric} — ${vibeFaultEvent.timestamp}</h6>
        ${corroborationNote}
        <table class="table table-striped table-hover align-middle mt-3" data-testid="fault-bands-table">
          <thead>
            <tr>
              <th scope="col">Band</th>
              <th scope="col">Energy</th>
              <th scope="col">Anomaly Score</th>
            </tr>
          </thead>
          <tbody>${bandRows}</tbody>
        </table>
      </div>
    </div>`;
}
