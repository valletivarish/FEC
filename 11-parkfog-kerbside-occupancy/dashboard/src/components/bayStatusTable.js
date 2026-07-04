// Maps bay_state_event entities (keyed by bayId) into a card-grid of bay tiles — one card per kerb space.
const BAY_IDS = ['bay-01', 'bay-02', 'bay-03', 'bay-04', 'bay-05', 'bay-06'];
const EV_BAY_ID = 'bay-06';

function stateBadgeClass(state) {
  // Inverted from a status-severity palette: unoccupied/available is the "good" green signal.
  if (state === 'UNOCCUPIED') return 'text-bg-success';
  if (state === 'OCCUPIED') return 'text-bg-danger';
  return 'text-bg-secondary';
}

function stateLabel(state) {
  if (state === 'UNOCCUPIED') return 'AVAILABLE';
  if (state === 'OCCUPIED') return 'OCCUPIED';
  return 'UNKNOWN';
}

export function renderBayStatusTable(gridEl, bayEvents) {
  const latestByBay = new Map();
  for (const event of bayEvents) {
    latestByBay.set(event.bayId, event);
  }

  gridEl.innerHTML = '';
  for (const bayId of BAY_IDS) {
    const event = latestByBay.get(bayId);
    const state = event ? event.state : 'UNKNOWN';
    const fusedVote = event && typeof event.fusedVote === 'number' ? event.fusedVote.toFixed(2) : '—';
    const isViolation = Boolean(event && event.disabledBayViolation);
    const isEvBay = bayId === EV_BAY_ID;

    // Top-border color reflects state: available bays get the green nominal signal, others plum.
    const availableClass = state === 'UNOCCUPIED' ? ' bay-tile-available' : '';

    const col = document.createElement('div');
    col.className = 'col';
    col.innerHTML = `
      <div class="card bay-tile${availableClass} h-100" data-bay-id="${bayId}">
        <div class="card-body d-flex flex-column align-items-center text-center p-2">
          <div class="d-flex justify-content-between align-items-start w-100 mb-1">
            <span class="bay-tile-id">${bayId}</span>
            ${isEvBay ? '<span class="badge rounded-pill text-bg-info bay-ev-badge" title="EV charging bay">EV</span>' : '<span></span>'}
          </div>
          <span class="badge rounded-pill bay-state-badge ${stateBadgeClass(state)}">${stateLabel(state)}</span>
          <span class="bay-tile-vote small text-muted mt-1" title="Fused occupancy confidence from magnetometer and infrared sensors -- 0 to 1, higher means more confident the bay state is correct">vote ${fusedVote}</span>
          ${isViolation ? '<span class="badge rounded-pill text-bg-warning bay-violation-badge mt-1">VIOLATION</span>' : ''}
        </div>
      </div>
    `;
    gridEl.appendChild(col);
  }
}
