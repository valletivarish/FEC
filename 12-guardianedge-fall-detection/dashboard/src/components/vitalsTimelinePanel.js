// Small hand-rolled SVG sparkline keeps this dependency-free per the no-charting-library brief.
function buildSparklinePoints(values, width, height) {
  if (values.length === 1) {
    return `0,${height / 2} ${width},${height / 2}`;
  }
  const min = Math.min(...values);
  const max = Math.max(...values);
  const range = max - min || 1;
  const step = width / (values.length - 1);
  return values
    .map((value, index) => {
      const x = index * step;
      const y = height - ((value - min) / range) * height;
      return `${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(' ');
}

function sparklineSvg(rrHistory) {
  const width = 160;
  const height = 40;
  if (!rrHistory || rrHistory.length === 0) {
    return '<span class="text-muted">Not enough HRV samples yet.</span>';
  }
  const points = buildSparklinePoints(rrHistory, width, height);
  return `
    <svg viewBox="0 0 ${width} ${height}" width="${width}" height="${height}" class="hrv-sparkline" role="img" aria-label="HRV sparkline">
      <polyline points="${points}" fill="none" stroke="#2f8a8a" stroke-width="2" stroke-linejoin="round" stroke-linecap="round" />
    </svg>`;
}

export function renderVitalsTimelinePanel(residents) {
  if (!residents || residents.length === 0) {
    return `
      <div class="list-group shadow-sm" data-testid="vitals-timeline-list">
        <div class="list-group-item py-3 text-muted" data-testid="vitals-timeline-empty">
          No vitals timeline data available yet.
        </div>
      </div>`;
  }

  const items = residents
    .map((resident) => {
      const name = resident.residentName || resident.residentId;
      const sdnn = resident.sdnnMs != null ? `${resident.sdnnMs.toFixed(1)} ms` : 'Not yet computed';
      return `
      <div class="list-group-item py-3" data-testid="vitals-timeline-item" data-resident-id="${resident.residentId}">
        <div class="fw-semibold mb-1">${name}</div>
        <div class="text-muted mb-1" title="Heart Rate Variability measures beat-to-beat changes in heart rhythm; higher SDNN generally indicates better autonomic/cardiac adaptability, while sustained low readings may warrant clinical review.">Heart Rate Variability (SDNN): <span data-testid="sdnn-value">${sdnn}</span></div>
        <div data-testid="hrv-sparkline" class="hrv-sparkline-trace">${sparklineSvg(resident.rrHistory)}</div>
      </div>`;
    })
    .join('');

  return `<div class="list-group shadow-sm" data-testid="vitals-timeline-list">${items}</div>`;
}
