// Signature element: ticks a T+ style "time since last downlink" clock and flips
// NOMINAL/DEGRADED off real dispatch-event staleness, not a decorative timer.
const DISPATCH_INTERVAL_MS = 10000;
const DEGRADED_THRESHOLD_MS = DISPATCH_INTERVAL_MS * 3;

let lastDownlinkAt = Date.now();

function formatDuration(ms) {
  const totalSeconds = Math.max(0, Math.floor(ms / 1000));
  const hh = String(Math.floor(totalSeconds / 3600)).padStart(2, '0');
  const mm = String(Math.floor((totalSeconds % 3600) / 60)).padStart(2, '0');
  const ss = String(totalSeconds % 60).padStart(2, '0');
  return `${hh}:${mm}:${ss}`;
}

function tick() {
  const elapsed = Date.now() - lastDownlinkAt;
  const remaining = DISPATCH_INTERVAL_MS - (elapsed % DISPATCH_INTERVAL_MS);
  const degraded = elapsed > DEGRADED_THRESHOLD_MS;

  const lastEl = document.getElementById('acq-last-downlink');
  const nextEl = document.getElementById('acq-next-downlink');
  const signalEl = document.getElementById('acq-signal-state');
  const windowEl = document.getElementById('acq-window-state');
  const barEl = document.getElementById('acq-bar');
  if (!lastEl || !nextEl || !signalEl || !windowEl || !barEl) return;

  lastEl.textContent = formatDuration(elapsed);
  nextEl.textContent = formatDuration(remaining);
  signalEl.textContent = degraded ? 'DEGRADED' : 'NOMINAL';
  windowEl.textContent = degraded ? 'STALE' : 'OPEN';
  barEl.classList.toggle('ff-acq-degraded', degraded);
}

// Called by main.js whenever a fetch cycle actually lands new data, so the bar
// reflects real dispatch activity rather than page-load time alone.
export function markDownlinkReceived() {
  lastDownlinkAt = Date.now();
}

function init() {
  tick();
  setInterval(tick, 1000);
}

if (typeof window !== 'undefined' && !window.__FLOWFORGE_SKIP_AUTOINIT__) {
  document.addEventListener('DOMContentLoaded', init);
  window.__flowforgeMarkDownlink = markDownlinkReceived;
}
