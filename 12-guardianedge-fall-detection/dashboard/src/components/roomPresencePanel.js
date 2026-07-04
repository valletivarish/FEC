// Latest presence/comfort/inactivity signal per resident, one glanceable line each.
const EVENT_LABELS = {
  presence_event: 'Presence',
  comfort_event: 'Comfort',
  inactivity_alert: 'Inactivity alert',
};

function formatTimestamp(timestamp) {
  try {
    return new Date(timestamp).toLocaleString();
  } catch {
    return timestamp;
  }
}

function describeEvent(event) {
  if (event.type === 'presence_event') {
    return `Room now ${event.occupancyState || event.state || 'updated'}`;
  }
  if (event.type === 'comfort_event') {
    return `Comfort issue: ${event.issue || 'unspecified'}`;
  }
  if (event.type === 'inactivity_alert') {
    return 'No motion detected for an extended period';
  }
  return 'Room status updated';
}

export function renderRoomPresencePanel(roomEvents) {
  if (!roomEvents || roomEvents.length === 0) {
    return `
      <div class="list-group shadow-sm" data-testid="room-presence-list">
        <div class="list-group-item py-3 text-muted" data-testid="room-presence-empty">
          No room activity has been reported yet.
        </div>
      </div>`;
  }

  const items = roomEvents
    .map((event) => {
      const name = event.residentName || event.residentId;
      const label = EVENT_LABELS[event.type] || 'Room update';
      return `
      <div class="list-group-item py-3" data-testid="room-presence-item" data-resident-id="${event.residentId}">
        <div class="d-flex justify-content-between align-items-center flex-wrap gap-2">
          <div>
            <div class="fw-semibold mb-1">${name}</div>
            <div class="fs-6 text-muted">${describeEvent(event)}</div>
          </div>
          <span class="badge rounded-pill text-bg-light border fs-6" data-testid="room-event-label">${label} &middot; ${formatTimestamp(event.timestamp)}</span>
        </div>
      </div>`;
    })
    .join('');

  return `<div class="list-group shadow-sm" data-testid="room-presence-list">${items}</div>`;
}
