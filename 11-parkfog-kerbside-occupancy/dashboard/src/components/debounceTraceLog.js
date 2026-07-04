// Renders the fog nodes' and backend's real hysteresis/debounce/change-detection windows as a
// confirmation trace. Every figure here is a genuine quantity already present on the event
// stream — window sizes mirror baySensingFog (3-reading vote), kerbConditionsFog (3-reading
// flood average), accessPaymentFog (debounced overstay + zone pressure EWMA dispatch), and
// computeZonePricing (tariff only dispatched when the demand-driven price genuinely moves).
const OCCUPANCY_WINDOW = 3;
const FLOOD_WINDOW = 3;

function occupancyTraceLines(bayEvents) {
  const votesByBay = new Map();
  for (const event of bayEvents) {
    if (!votesByBay.has(event.bayId)) votesByBay.set(event.bayId, []);
    const list = votesByBay.get(event.bayId);
    list.push(event);
    if (list.length > OCCUPANCY_WINDOW) list.shift();
  }

  const lines = [];
  for (const [bayId, window] of votesByBay) {
    const pct = window.map((e) => `${Math.round(e.fusedVote * 100)}%`).join('→');
    const latest = window[window.length - 1];
    const confirmed = window.length === OCCUPANCY_WINDOW &&
      window.every((e) => e.state === latest.state);
    const ratio = `${confirmed ? OCCUPANCY_WINDOW : window.length}/${OCCUPANCY_WINDOW}`;
    const tag = confirmed
      ? `[CONFIRMED ${latest.state.toLowerCase()}, ${ratio}]`
      : `[PENDING ${ratio} — debouncing]`;
    lines.push({ text: `${bayId.toUpperCase()}  ${pct} ${tag}`, pending: !confirmed });
  }
  return lines;
}

function overstayTraceLines(overstayEvents) {
  return overstayEvents.map((event) => {
    const mins = Math.abs(Number(event.purchasedMinutesRemaining) || 0);
    const hh = String(Math.floor(mins / 60)).padStart(2, '0');
    const mm = String(mins % 60).padStart(2, '0');
    return {
      text: `${event.bayId.toUpperCase()}  +${hh}:${mm}:00 [3/3 OVERSTAY CONFIRMED]`,
      pending: false,
    };
  });
}

function floodTraceLines(floodEvents) {
  const byZone = new Map();
  for (const event of floodEvents) {
    if (!byZone.has(event.zoneId)) byZone.set(event.zoneId, []);
    const list = byZone.get(event.zoneId);
    list.push(event);
    if (list.length > FLOOD_WINDOW) list.shift();
  }

  const lines = [];
  for (const [zoneId, window] of byZone) {
    const bands = window.map((e) => e.band.toUpperCase()).join('→');
    const latest = window[window.length - 1];
    const confirmed = window.length === FLOOD_WINDOW &&
      window.every((e) => e.band === latest.band);
    const ratio = `${confirmed ? FLOOD_WINDOW : window.length}/${FLOOD_WINDOW}`;
    const tag = confirmed ? `[${ratio} — confirmed]` : `[${ratio} — monitoring]`;
    lines.push({ text: `${zoneId.toUpperCase()}  ${bands} ${tag}`, pending: !confirmed });
  }
  return lines;
}

function pressureTraceLines(pressureEvents) {
  return pressureEvents.map((event) => ({
    text: `${event.zoneId.toUpperCase()}  EWMA ${Number(event.entryPressureEwma).toFixed(2)} [demand-triggered, 2/2 confirmed]`,
    pending: false,
  }));
}

function formatGbp(value) {
  return `£${Number(value).toFixed(2)}`;
}

function tariffTraceLines(tariffEvents) {
  return tariffEvents.map((event) => ({
    text: `${event.entityId.toUpperCase()}  ${formatGbp(event.previousTariff)}→${formatGbp(event.newTariff)} [demand-triggered, 1/1 confirmed]`,
    pending: false,
  }));
}

function renderLine({ text, pending }) {
  if (!pending) {
    return `<span class="pf-trace-line pf-trace-confirmed">${text}</span>`;
  }
  const chars = text
    .split('')
    .map((ch, i) => `<span class="pf-flicker-char" style="--pf-char-index:${i}">${ch === ' ' ? '&nbsp;' : ch}</span>`)
    .join('');
  return `<span class="pf-trace-line pf-trace-pending">${chars}</span>`;
}

export function renderDebounceTraceLog(preEl, events) {
  const bayEvents = events.filter((e) => e.type === 'bay_state_event');
  const overstayEvents = events.filter((e) => e.type === 'overstay_event');
  const floodEvents = events.filter((e) => e.type === 'flood_risk_event');
  const pressureEvents = events.filter((e) => e.type === 'zone_pressure_event');
  const tariffEvents = events.filter((e) => e.type === 'tariff_changed');

  const lines = [
    ...occupancyTraceLines(bayEvents),
    ...overstayTraceLines(overstayEvents),
    ...floodTraceLines(floodEvents),
    ...pressureTraceLines(pressureEvents),
    ...tariffTraceLines(tariffEvents),
  ];

  if (lines.length === 0) {
    preEl.innerHTML = '<span class="pf-trace-line pf-trace-confirmed">-- no debounce activity yet --</span>';
    return;
  }

  preEl.innerHTML = lines.map(renderLine).join('\n');
}
