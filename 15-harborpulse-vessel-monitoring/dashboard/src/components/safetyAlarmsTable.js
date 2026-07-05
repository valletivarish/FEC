function formatCoord(value) {
  if (value === null || value === undefined || Number.isNaN(value)) return '—';
  return Number(value).toFixed(4);
}

function formatNumber(value, digits = 1) {
  if (value === null || value === undefined || Number.isNaN(value)) return '—';
  return Number(value).toFixed(digits);
}

// bilge level and heading come from the same bilge_alarm / gps_track_event payloads
// already queried for this table — surfacing them here avoids a second dashboard section
// for what is otherwise just two more numeric fields per vessel row.
function buildRow(entry, latestGps) {
  const tr = document.createElement('tr');
  const active = Boolean(entry.alarmActive);
  const badgeClass = active ? 'text-bg-danger' : 'text-bg-secondary';
  const badgeText = active ? 'ACTIVE' : 'RESOLVED';
  const gps = latestGps.get(entry.vesselId);

  tr.innerHTML = `
    <td>${entry.vesselId}</td>
    <td><span class="badge rounded-pill ${badgeClass}">${badgeText}</span></td>
    <td>${formatNumber(entry.level)}</td>
    <td>${gps ? formatCoord(gps.lat) : '—'}</td>
    <td>${gps ? formatCoord(gps.lon) : '—'}</td>
    <td>${gps ? formatNumber(gps.headingDeg, 0) : '—'}</td>
    <td>${entry.timestamp || '—'}</td>
  `;
  return tr;
}

export function renderSafetyAlarmsTable(tbody, alarmEvents, telemetryEvents) {
  tbody.innerHTML = '';

  const latestGps = new Map();
  (telemetryEvents || [])
    .filter((event) => event.type === 'gps_track_event')
    .forEach((event) => {
      const existing = latestGps.get(event.vesselId);
      if (!existing || event.timestamp > existing.timestamp) {
        latestGps.set(event.vesselId, event);
      }
    });

  if (!alarmEvents || alarmEvents.length === 0) {
    const tr = document.createElement('tr');
    tr.innerHTML = '<td colspan="7" class="text-center text-body-secondary">No alarm history available.</td>';
    tbody.appendChild(tr);
    return;
  }

  const sorted = [...alarmEvents].sort((a, b) => (b.timestamp || '').localeCompare(a.timestamp || ''));
  sorted.forEach((entry) => tbody.appendChild(buildRow(entry, latestGps)));
}
