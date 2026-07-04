// Fall incidents need an explicit carer acknowledgement, so this panel owns the POST + DOM removal.
function formatTimestamp(timestamp) {
  try {
    return new Date(timestamp).toLocaleString();
  } catch {
    return timestamp;
  }
}

export function renderFallIncidentPanel(fallEvents) {
  if (!fallEvents || fallEvents.length === 0) {
    return `
      <div class="list-group shadow-sm" data-testid="fall-incident-list">
        <div class="list-group-item py-3 text-muted" data-testid="fall-incident-empty">
          No fall incidents reported. Everyone is safe right now.
        </div>
      </div>`;
  }

  const items = fallEvents
    .map((event) => {
      const name = event.residentName || event.residentId;
      return `
      <div class="list-group-item d-flex justify-content-between align-items-center py-3" data-testid="fall-incident-item" data-resident-id="${event.residentId}">
        <div>
          <div class="fw-semibold mb-1">${name}</div>
          <div class="text-muted">Fall confirmed at ${formatTimestamp(event.timestamp)}</div>
        </div>
        <button type="button" class="ack-button" data-testid="acknowledge-button" data-resident-id="${event.residentId}">
          Acknowledge
        </button>
      </div>`;
    })
    .join('');

  return `<div class="list-group shadow-sm" data-testid="fall-incident-list">${items}</div>`;
}

// Sidebar nav badge mirrors whatever is still unacknowledged in the panel, no separate fetch.
export function countUnacknowledgedFalls(container) {
  return container.querySelectorAll('[data-testid="fall-incident-item"]:not([data-acknowledged="true"])').length;
}

export function updateFallIncidentNavBadge(container) {
  const badge = document.getElementById('fall-incident-badge');
  if (!badge) return;
  const count = countUnacknowledgedFalls(container);
  if (count === 0) {
    badge.classList.add('d-none');
    badge.textContent = '';
  } else {
    badge.classList.remove('d-none');
    badge.textContent = String(count);
  }
}

export function wireFallIncidentAcknowledgements(container, apiClient) {
  updateFallIncidentNavBadge(container);

  container.querySelectorAll('[data-testid="acknowledge-button"]').forEach((button) => {
    button.addEventListener('click', async () => {
      const residentId = button.dataset.residentId;
      button.disabled = true;
      button.classList.add('is-acked');
      button.textContent = 'Acknowledging...';
      try {
        await apiClient.acknowledgeResident(residentId);
        const item = button.closest('[data-testid="fall-incident-item"]');
        if (item) {
          item.classList.add('list-group-item-secondary', 'text-muted');
          item.setAttribute('data-acknowledged', 'true');
          button.remove();
        }
        updateFallIncidentNavBadge(container);
      } catch {
        button.disabled = false;
        button.classList.remove('is-acked');
        button.textContent = 'Acknowledge';
      }
    });
  });
}
