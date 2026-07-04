import { getActiveAlerts } from '../apiClient.js';

// No ack-write-path in this brief - button just clears the row client-side for now.
function acknowledgeAlert(alertId) {
  return Promise.resolve({ alertId, acknowledged: true });
}

function badgeClass(severity) {
  if (severity === 'BREACH') return 'text-bg-danger';
  if (severity === 'WARN') return 'text-bg-warning';
  return 'text-bg-secondary';
}

function alertRow(alert) {
  const id = `${alert.zoneId}-${alert.eventType}-${alert.timestamp}`;
  return `
    <tr class="alert-row severity-${alert.severity.toLowerCase()}" data-alert-id="${id}">
      <td class="alert-zone">${alert.zoneId}</td>
      <td class="alert-type">${alert.eventType}</td>
      <td><span class="badge rounded-pill ${badgeClass(alert.severity)}">${alert.severity}</span></td>
      <td class="num alert-time">${alert.timestamp}</td>
      <td><button class="alert-ack-btn btn btn-sm btn-outline-secondary" data-alert-id="${id}" type="button">Acknowledge</button></td>
    </tr>
  `;
}

export async function renderAlertFeedView(container) {
  container.innerHTML = `
    <section class="section alert-feed-panel card" aria-label="Active alerts">
      <div class="card-body">
        <h2 class="panel-heading card-title h6 text-uppercase text-muted">Active Alerts</h2>
        <div class="table-responsive">
          <table class="table table-striped table-hover align-middle">
            <thead>
              <tr>
                <th scope="col">Zone</th>
                <th scope="col">Event</th>
                <th scope="col">Severity</th>
                <th scope="col">Timestamp</th>
                <th scope="col">Action</th>
              </tr>
            </thead>
            <tbody id="alert-feed-list">
              <tr><td colspan="5" class="empty-note text-muted">Loading...</td></tr>
            </tbody>
          </table>
        </div>
      </div>
    </section>
  `;

  const list = container.querySelector('#alert-feed-list');

  let response;
  try {
    response = await getActiveAlerts();
  } catch {
    list.innerHTML = '<tr><td colspan="5" class="empty-note text-muted">No live data — start the local stack to see readings.</td></tr>';
    return;
  }

  const alerts = response.alerts || [];
  if (alerts.length === 0) {
    list.innerHTML = '<tr><td colspan="5" class="empty-note text-muted">No active alerts.</td></tr>';
    return;
  }

  list.innerHTML = alerts.map(alertRow).join('');

  list.querySelectorAll('.alert-ack-btn').forEach((button) => {
    button.addEventListener('click', async () => {
      button.disabled = true;
      button.textContent = 'Acknowledging...';
      await acknowledgeAlert(button.dataset.alertId);
      const row = list.querySelector(`tr[data-alert-id="${button.dataset.alertId}"]`);
      if (row) row.classList.add('alert-acknowledged');
      button.textContent = 'Acknowledged';
    });
  });
}
