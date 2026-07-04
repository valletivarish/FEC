// Chronological, most-recent-first feed across every event type from the zone status response.
const EVENT_LABELS = {
  bay_state_event: 'Bay State',
  overstay_event: 'Overstay',
  zone_pressure_event: 'Zone Pressure',
  flood_risk_event: 'Flood Risk',
  ev_fault_event: 'EV Fault',
  tariff_changed: 'Tariff Change',
};

function summarize(event) {
  switch (event.type) {
    case 'bay_state_event':
      return `${event.state}, fused vote ${Number(event.fusedVote).toFixed(2)}`;
    case 'overstay_event':
      return `${event.purchasedMinutesRemaining} min remaining, ANPR ${event.anprConfidence}%`;
    case 'zone_pressure_event':
      return `EWMA ${Number(event.entryPressureEwma).toFixed(2)}`;
    case 'flood_risk_event':
      return `${event.band}, avg ${event.averageFloodLevel} mm`;
    case 'ev_fault_event':
      return '15 consecutive fault readings';
    case 'tariff_changed':
      return `£${Number(event.previousTariff).toFixed(2)} → £${Number(event.newTariff).toFixed(2)}, demand ${Number(event.demandSignal).toFixed(2)}`;
    default:
      return '';
  }
}

export function renderEventLogTable(tbodyEl, events) {
  tbodyEl.innerHTML = '';

  if (!events || events.length === 0) {
    return;
  }

  const sorted = [...events].sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));

  for (const event of sorted) {
    const row = document.createElement('tr');
    const entityId = event.bayId || event.zoneId || event.entityId || '—';
    row.innerHTML = `
      <td>${event.timestamp}</td>
      <td>${EVENT_LABELS[event.type] || event.type}</td>
      <td>${entityId}</td>
      <td>${summarize(event)}</td>
    `;
    tbodyEl.appendChild(row);
  }
}
