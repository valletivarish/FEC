const TYPE_LABELS = {
  vibe_fault: 'Vibe Fault',
  thermal_event: 'Thermal Event',
  hydraulic_event: 'Hydraulic Event',
  acoustic_advisory: 'Advisory',
};

// advisory is not a fault — light badge keeps it visually subordinate to the fault-severity colors
function badgeForType(type) {
  if (type === 'vibe_fault') return 'text-bg-danger';
  if (type === 'thermal_event') return 'text-bg-warning';
  if (type === 'hydraulic_event') return 'text-bg-warning';
  if (type === 'acoustic_advisory') return 'text-bg-light';
  return 'text-bg-secondary';
}

// borderline severity class tints the list item itself so the ticker reads like a live log,
// not just a list of identical rows with different badges
function severityListClass(event) {
  if (event.type === 'vibe_fault') return 'list-group-item-danger';
  if (event.type === 'thermal_event' && (event.verdict_tags || []).includes('runaway')) return 'list-group-item-danger';
  return '';
}

// one line of detail per event type keeps the ticker scannable without opening each row
function detailFor(event) {
  if (event.type === 'vibe_fault') {
    const top = (event.fault_bands || [])[0];
    const base = top ? `${event.metric} — top band ${top.band} @ ${Number(top.energy).toFixed(2)}` : event.metric;
    return event.acoustic_corroborated ? `${base} (acoustic-corroborated)` : base;
  }
  if (event.type === 'thermal_event') {
    return (event.verdict_tags || []).join(', ') || 'no tags';
  }
  if (event.type === 'hydraulic_event') {
    return `efficiency ${Number(event.efficiency).toFixed(2)}`;
  }
  if (event.type === 'acoustic_advisory') {
    return `${Number(event.db_level).toFixed(1)} dB`;
  }
  return '';
}

function emptyMarkup() {
  return `
    <div class="card">
      <div class="card-body">
        <p class="text-body-secondary mb-0" data-testid="fault-ticker-empty">No fault events yet — the ticker updates as fog nodes dispatch diagnoses.</p>
      </div>
    </div>`;
}

// the ticker is a list-group, not a table — a scrolling log feel, most recent event on top
export function renderFaultTicker(container, events) {
  if (!events || events.length === 0) {
    container.innerHTML = emptyMarkup();
    return;
  }

  const sorted = [...events].sort((a, b) => (a.timestamp < b.timestamp ? 1 : -1));

  const items = sorted.map((evt) => `
    <li class="list-group-item d-flex justify-content-between align-items-start gap-3 ${severityListClass(evt)}"
        data-testid="ticker-item" data-asset-id="${evt.asset_id}" data-event-type="${evt.type}">
      <div class="d-flex flex-column">
        <span class="fw-semibold">${evt.asset_id}
          <span class="badge rounded-pill ${badgeForType(evt.type)} ms-1">${TYPE_LABELS[evt.type] || evt.type}</span>
        </span>
        <span class="small text-body-secondary" data-testid="ticker-item-detail">${detailFor(evt)}</span>
      </div>
      <span class="small text-nowrap text-body-secondary" data-testid="ticker-item-timestamp">${evt.timestamp}</span>
    </li>`).join('');

  container.innerHTML = `
    <div class="card">
      <ul class="list-group list-group-flush" data-testid="fault-ticker-list">${items}</ul>
    </div>`;
}
