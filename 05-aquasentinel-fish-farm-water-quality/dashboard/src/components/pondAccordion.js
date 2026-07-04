// Renders the pond accordion — one accordion-item per pond, collapsed by default.
// Each pond's full detail (metrics, toxicity provenance, hypoxia watch, feed correlation)
// lives inside that pond's own accordion-body instead of separate always-visible tables.

// latest_readings holds one item per fog event TYPE (life_support/toxicity/ops_feed_correlation),
// each wrapping its real dispatched fields in .payload -- never raw per-metric readings.
function payloadFor(latestReadings, type) {
  const item = (latestReadings || []).find((x) => x.type === type);
  return item ? item.payload : null;
}

function fmt(value, digits = 2) {
  return typeof value === 'number' ? value.toFixed(digits) : '—';
}

function ammoniaBadge(uiaSeverity) {
  const map = {
    safe: 'text-bg-success',
    elevated: 'text-bg-warning',
    toxic: 'text-bg-danger',
  };
  const cls = map[uiaSeverity] || 'text-bg-secondary';
  const label = uiaSeverity || 'unknown';
  return `<span class="badge rounded-pill ${cls}">${label}</span>`;
}

function statusBadge(ok) {
  if (!ok) return '<span class="badge rounded-pill text-bg-secondary">offline</span>';
  return '<span class="badge rounded-pill text-bg-success">nominal</span>';
}

function stageBadge(stage) {
  const map = {
    hypoxia_warning: 'text-bg-warning',
    hypoxia_critical: 'text-bg-danger',
    cleared: 'text-bg-success',
  };
  const cls = map[stage] || 'text-bg-secondary';
  return `<span class="badge rounded-pill ${cls}">${stage || 'unknown'}</span>`;
}

function severityBadge(severity) {
  const map = {
    safe: 'text-bg-success',
    elevated: 'text-bg-warning',
    toxic: 'text-bg-danger',
  };
  const cls = map[severity] || 'text-bg-secondary';
  return `<span class="badge rounded-pill ${cls}">${severity || 'unknown'}</span>`;
}

function metricStat(label, value, titleText) {
  const titleAttr = titleText ? ` title="${titleText}"` : '';
  return `
    <div class="col-6 col-md-4 col-lg-2">
      <div class="pond-metric-label text-muted small"${titleAttr}>${label}</div>
      <div class="pond-metric-value fs-5">${value}</div>
    </div>`;
}

function provenanceRow(label, value, titleText) {
  const titleAttr = titleText ? ` title="${titleText}"` : '';
  return `
    <div class="d-flex justify-content-between border-bottom py-1">
      <span class="text-muted"${titleAttr}>${label}</span>
      <span class="font-monospace">${value}</span>
    </div>`;
}

function renderToxicitySubsection(pondId, toxicityEvent) {
  if (!toxicityEvent) {
    return `<p class="text-muted mb-0 small">No toxicity alert on record for this pond</p>`;
  }
  const p = toxicityEvent.provenance || {};
  return `
    <div class="d-flex justify-content-between align-items-center mb-2">
      <span class="fw-semibold">UIA calculation provenance</span>
      ${severityBadge(toxicityEvent.severity)}
    </div>
    ${provenanceRow('pH', p.ph !== undefined ? Number(p.ph).toFixed(2) : '—')}
    ${provenanceRow('Water Temp (°C)', p.water_temperature !== undefined ? Number(p.water_temperature).toFixed(1) : '—')}
    ${provenanceRow('Salinity (ppt)', p.salinity !== undefined ? Number(p.salinity).toFixed(1) : '—')}
    ${provenanceRow('Nitrite NO2 (mg/L)', p.nitrite_no2 !== undefined && p.nitrite_no2 !== null ? Number(p.nitrite_no2).toFixed(3) : '—')}
    ${provenanceRow('pKa', p.pka !== undefined ? Number(p.pka).toFixed(4) : '—', 'Acid dissociation constant used in the un-ionized ammonia calculation.')}
    ${provenanceRow('Corrected Fraction', p.corrected_fraction !== undefined ? Number(p.corrected_fraction).toFixed(6) : '—')}
    ${provenanceRow('UIA (mg/L)', toxicityEvent.uia_mg_per_l !== undefined ? Number(toxicityEvent.uia_mg_per_l).toFixed(4) : '—', 'Un-ionized Ammonia -- the toxic form of ammonia to fish; higher values are more dangerous.')}
    ${provenanceRow('Brown Blood Risk', toxicityEvent.nitrite_brown_blood_risk ? 'yes' : 'no')}
  `;
}

// Hypoxia Stage Ladder -- four rungs mirroring the real DO threshold bands from
// fog/fog_life_support.py (BASE_WARNING_THRESHOLD=4.0, BASE_CRITICAL_THRESHOLD=3.0 mg/L).
// Anoxic is a presentational sub-band of "hypoxia_critical" for near-zero DO, not a new
// backend stage. Current worst-case reading lit solid, the rest sit dim-outlined.
const HYPOXIA_RUNGS = [
  { key: 'normoxic', label: 'Normoxic', band: '≥ 4.0 mg/L' },
  { key: 'mild', label: 'Mild Hypoxia', band: '3.0 – 4.0 mg/L' },
  { key: 'severe', label: 'Severe Hypoxia', band: '1.0 – 3.0 mg/L' },
  { key: 'anoxic', label: 'Anoxic', band: '< 1.0 mg/L' },
];

// The fog node's own stage is authoritative -- it can flag hypoxia_critical off a sharp
// rate-of-change even when the raw DO value alone would only read as "mild" by threshold.
// DO value only breaks the tie between Severe/Anoxic within an already-critical stage.
function rungKeyForDo(doValue, stage) {
  if (stage === 'hypoxia_critical') {
    return typeof doValue === 'number' && doValue < 1.0 ? 'anoxic' : 'severe';
  }
  if (stage === 'hypoxia_warning') return 'mild';
  if (stage === 'cleared' || !stage) return 'normoxic';
  if (typeof doValue !== 'number') return null;
  if (doValue < 1.0) return 'anoxic';
  if (doValue < 3.0) return 'severe';
  if (doValue < 4.0) return 'mild';
  return 'normoxic';
}

function renderHypoxiaLadder(doValue, stage) {
  const activeKey = rungKeyForDo(doValue, stage);
  const rungs = HYPOXIA_RUNGS.map((rung) => {
    const isActive = rung.key === activeKey;
    return `
      <div class="hypoxia-rung${isActive ? ' is-active' : ''}" data-rung="${rung.key}">
        <span>${rung.label}</span>
        <span class="hypoxia-rung-band">${rung.band}</span>
      </div>`;
  }).join('');
  return `<div class="hypoxia-ladder" data-hypoxia-ladder>${rungs}</div>`;
}

function renderHypoxiaSubsection(pondId, lifeSupportEvent) {
  const doValue = lifeSupportEvent ? lifeSupportEvent.dissolved_oxygen : undefined;
  const stage = lifeSupportEvent ? lifeSupportEvent.stage : null;
  const ladder = renderHypoxiaLadder(doValue, stage);

  const active = lifeSupportEvent && lifeSupportEvent.stage && lifeSupportEvent.stage !== 'cleared'
    ? [lifeSupportEvent]
    : [];
  if (active.length === 0) {
    return `${ladder}<p class="text-muted mb-0 small mt-3">No active hypoxia watch for this pond</p>`;
  }
  const rows = active
    .map(
      (e) => `
        <tr>
          <td>${stageBadge(e.stage)}</td>
          <td>${typeof e.dissolved_oxygen === 'number' ? e.dissolved_oxygen.toFixed(2) : '—'}</td>
          <td>${typeof e.rate_of_change === 'number' ? e.rate_of_change.toFixed(3) : '—'}</td>
          <td>${typeof e.water_level === 'number' ? e.water_level.toFixed(1) : '—'}</td>
        </tr>`
    )
    .join('');
  return `
    ${ladder}
    <div class="table-responsive mt-3">
      <table class="table table-sm table-hover align-middle mb-0" data-pond-hypoxia-table="${pondId}">
        <thead>
          <tr>
            <th scope="col">Stage</th>
            <th scope="col">DO (mg/L)</th>
            <th scope="col">Rate of Change (mg/L/min)</th>
            <th scope="col">Water Level (cm)</th>
          </tr>
        </thead>
        <tbody>${rows}</tbody>
      </table>
    </div>`;
}

function renderFeedSubsection(pondId, opsEvent) {
  const opsEvents = opsEvent ? [opsEvent] : [];
  if (opsEvents.length === 0) {
    return `<p class="text-muted mb-0 small">No feed correlation signal for this pond</p>`;
  }
  const rows = opsEvents
    .map((e) => {
      const confidence = typeof e.overfeeding_confidence === 'number' ? e.overfeeding_confidence.toFixed(2) : '—';
      const signals = Array.isArray(e.contributing_signals) && e.contributing_signals.length > 0
        ? e.contributing_signals.join(', ')
        : '—';
      const feeder = typeof e.feeder_load_cell === 'number' ? e.feeder_load_cell.toFixed(0) : '—';
      const ammonia = typeof e.ammonia_nh3_total === 'number' ? e.ammonia_nh3_total.toFixed(2) : '—';
      const turbidity = typeof e.turbidity === 'number' ? e.turbidity.toFixed(1) : '—';
      const orp = typeof e.orp === 'number' ? e.orp.toFixed(0) : '—';
      return `
        <tr>
          <td>${confidence}</td>
          <td>${signals}</td>
          <td>${feeder}</td>
          <td>${ammonia}</td>
          <td>${turbidity}</td>
          <td>${orp}</td>
        </tr>`;
    })
    .join('');
  return `
    <div class="table-responsive">
      <table class="table table-sm table-hover align-middle mb-0" data-pond-feed-table="${pondId}">
        <thead>
          <tr>
            <th scope="col">Overfeeding Confidence</th>
            <th scope="col">Contributing Signals</th>
            <th scope="col">Feeder Load (g/cycle)</th>
            <th scope="col">Ammonia (mg/L)</th>
            <th scope="col">Turbidity (NTU)</th>
            <th scope="col">ORP (mV)</th>
          </tr>
        </thead>
        <tbody>${rows}</tbody>
      </table>
    </div>`;
}

// pondBundles: [{ pondId, ok, data, toxicityEvent }]
// data.latest_readings (the /status response) holds the LATEST event of each fog-processed type,
// merged server-side from both the readings and alerts tables -- life_support and
// ops_feed_correlation are read from it directly rather than from /alerts, since the dispatcher
// only ever routes urgent toxicity there. There is no raw per-metric feed from the backend by
// design, so every one of the 10 sensors is read from whichever dispatched event carries it as
// its own signal or as dispatch-time context.
export function renderPondAccordion(accordionEl, pondBundles) {
  if (!pondBundles || pondBundles.length === 0) {
    accordionEl.innerHTML = `<p class="text-muted text-center mb-0 py-4">No live data — start the local stack to see readings</p>`;
    return;
  }

  accordionEl.innerHTML = pondBundles
    .map((bundle, index) => {
      const { pondId, ok, data, toxicityEvent } = bundle;
      const latestReadings = ok && data ? data.latest_readings : null;
      const lifeSupportEvent = payloadFor(latestReadings, 'life_support');
      const opsEvent = payloadFor(latestReadings, 'ops_feed_correlation');
      const lifeSupport = lifeSupportEvent || {};
      const ops = opsEvent || {};
      const toxProvenance = (toxicityEvent && toxicityEvent.provenance) || {};
      const severity = toxicityEvent ? toxicityEvent.severity : null;

      const doVal = lifeSupport.dissolved_oxygen;
      const waterLevel = lifeSupport.water_level;
      const temp = toxProvenance.water_temperature;
      const ph = toxProvenance.ph;
      const salinity = toxProvenance.salinity;
      const nitrite = toxProvenance.nitrite_no2;
      const turbidity = ops.turbidity;
      const ammonia = ops.ammonia_nh3_total;
      const orp = ops.orp;
      const feederLoad = ops.feeder_load_cell;
      const collapseId = `pond-collapse-${pondId}`;
      const headingId = `pond-heading-${pondId}`;

      return `
        <div class="accordion-item" data-pond-item="${pondId}">
          <h2 class="accordion-header" id="${headingId}">
            <button class="accordion-button collapsed" type="button" data-bs-toggle="collapse"
                    data-bs-target="#${collapseId}" aria-expanded="false" aria-controls="${collapseId}">
              <span class="d-flex justify-content-between align-items-center w-100 pe-3">
                <span class="fw-semibold">${pondId}</span>
                ${statusBadge(ok)}
              </span>
            </button>
          </h2>
          <div id="${collapseId}" class="accordion-collapse collapse" aria-labelledby="${headingId}"
               data-bs-parent="#pond-accordion">
            <div class="accordion-body">
              <div class="row g-3 mb-4" data-pond-metrics="${pondId}">
                ${metricStat('DO (mg/L)', fmt(doVal))}
                ${metricStat('Temp (&deg;C)', fmt(temp, 1))}
                ${metricStat('pH', fmt(ph, 2))}
                ${metricStat('Salinity (ppt)', fmt(salinity, 1))}
                ${metricStat('Turbidity (NTU)', fmt(turbidity, 1))}
                ${metricStat('Ammonia (mg/L)', fmt(ammonia, 2))}
                ${metricStat('Nitrite NO2 (mg/L)', fmt(nitrite, 3))}
                ${metricStat('ORP (mV)', fmt(orp, 0), 'Oxidation-Reduction Potential -- indicates the water disinfecting and oxidizing capacity; very low or negative values can signal poor water quality.')}
                ${metricStat('Water Level (cm)', fmt(waterLevel, 1))}
                ${metricStat('Feeder Load (g/cycle)', fmt(feederLoad, 0))}
                ${metricStat('Ammonia Band', ammoniaBadge(severity))}
              </div>

              <h3 class="h6 text-uppercase text-muted mb-2">Toxicity Detail</h3>
              <div class="mb-4" data-pond-toxicity="${pondId}">
                ${renderToxicitySubsection(pondId, toxicityEvent)}
              </div>

              <h3 class="h6 text-uppercase text-muted mb-2">Hypoxia Watch</h3>
              <div class="mb-4" data-pond-hypoxia="${pondId}">
                ${renderHypoxiaSubsection(pondId, lifeSupportEvent)}
              </div>

              <h3 class="h6 text-uppercase text-muted mb-2">Feed &amp; Ammonia Correlation</h3>
              <div data-pond-feed="${pondId}">
                ${renderFeedSubsection(pondId, opsEvent)}
              </div>
            </div>
          </div>
        </div>`;
    })
    .join('');
}
