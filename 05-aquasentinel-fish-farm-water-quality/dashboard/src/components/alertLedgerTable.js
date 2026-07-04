// Chronological alert ledger, most recent first — the only place all alert types mix together.

function severityBadge(severity) {
  const map = {
    safe: 'text-bg-success',
    elevated: 'text-bg-warning',
    toxic: 'text-bg-danger',
    hypoxia_warning: 'text-bg-warning',
    hypoxia_critical: 'text-bg-danger',
    cleared: 'text-bg-success',
  };
  const labelMap = {
    hypoxia_warning: 'Hypoxia Warning',
    hypoxia_critical: 'Hypoxia Critical',
  };
  const cls = map[severity] || 'text-bg-secondary';
  const label = labelMap[severity] || severity || 'unknown';
  return `<span class="badge rounded-pill ${cls}">${label}</span>`;
}

export function renderAlertLedgerTable(tbodyEl, alerts) {
  if (!alerts || alerts.length === 0) {
    tbodyEl.innerHTML = `<tr><td colspan="4" class="text-center text-muted">No live data — start the local stack to see readings</td></tr>`;
    return;
  }

  const sorted = [...alerts].sort((a, b) => (a.timestamp < b.timestamp ? 1 : -1));

  tbodyEl.innerHTML = sorted
    .map((a) => {
      const severity = a.severity || a.stage || 'unknown';
      return `
        <tr>
          <td>${a.timestamp || '—'}</td>
          <td>${a.pond_id || '—'}</td>
          <td>${a.type || '—'}</td>
          <td>${severityBadge(severity)}</td>
        </tr>`;
    })
    .join('');
}
