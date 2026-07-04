import { getZoneHistory } from '../apiClient.js';

// Collapse raw readings into transitions only - a row for every tick is unreadable.
function toTransitions(readings) {
  const transitions = [];
  let previousValue = null;
  readings.forEach((reading) => {
    if (reading.value !== previousValue) {
      transitions.push(reading);
      previousValue = reading.value;
    }
  });
  return transitions;
}

function eventLabel(topic, value) {
  if (topic === 'door-contact') return value === 1 ? 'door opened' : 'door closed';
  if (topic === 'motion') return value === 1 ? 'motion detected' : 'motion cleared';
  if (topic === 'sound-level') return `sound ${value} dB`;
  return `${topic} = ${value}`;
}

function mergeSorted(lanes) {
  return lanes
    .flat()
    .sort((a, b) => new Date(a.timestamp) - new Date(b.timestamp));
}

function readingRowHtml(reading, zoneId) {
  return `
    <tr>
      <td class="num">${reading.timestamp}</td>
      <td>${zoneId}</td>
      <td>${eventLabel(reading.topic, reading.value)}</td>
      <td>--</td>
    </tr>
  `;
}

function badgeClass(severity) {
  if (severity === 'BREACH') return 'text-bg-danger';
  if (severity === 'WARN') return 'text-bg-warning';
  return 'text-bg-secondary';
}

function eventRowHtml(event, zoneId) {
  return `
    <tr>
      <td class="num">${event.timestamp}</td>
      <td>${zoneId}</td>
      <td>${event.eventType}</td>
      <td><span class="badge rounded-pill ${badgeClass(event.severity)}">${event.severity || 'INFO'}</span></td>
    </tr>
  `;
}

export async function renderSecurityTimelineView(container, zoneId) {
  container.innerHTML = `
    <section class="section security-panel card" aria-label="Security timeline">
      <div class="card-body">
        <h2 class="panel-heading card-title h6 text-uppercase text-muted">Security Timeline / ${zoneId}</h2>
        <div class="table-responsive">
          <table class="table table-striped table-hover align-middle">
            <thead>
              <tr>
                <th scope="col">Timestamp</th>
                <th scope="col">Zone</th>
                <th scope="col">Event</th>
                <th scope="col">Severity</th>
              </tr>
            </thead>
            <tbody id="security-timeline">
              <tr><td colspan="4" class="empty-note text-muted">Loading...</td></tr>
            </tbody>
          </table>
        </div>
      </div>
    </section>
  `;

  const [doorHistory, motionHistory, soundHistory] = await Promise.all([
    getZoneHistory(zoneId, 'door-contact').catch(() => ({ readings: [], events: [] })),
    getZoneHistory(zoneId, 'motion').catch(() => ({ readings: [], events: [] })),
    getZoneHistory(zoneId, 'sound-level').catch(() => ({ readings: [], events: [] })),
  ]);

  const transitions = mergeSorted([
    toTransitions(doorHistory.readings || []),
    toTransitions(motionHistory.readings || []),
  ]);

  const securityEvents = [
    ...(doorHistory.events || []),
    ...(motionHistory.events || []),
    ...(soundHistory.events || []),
  ].filter((event) => event.eventType === 'AFTER_HOURS_SECURITY_EVENT' || event.eventType === 'ZONE_CLEARED');

  const timeline = container.querySelector('#security-timeline');

  if (transitions.length === 0 && securityEvents.length === 0) {
    timeline.innerHTML = '<tr><td colspan="4" class="empty-note text-muted">No state transitions recorded.</td></tr>';
    return;
  }

  const readingEntries = transitions.map((reading) => ({ timestamp: reading.timestamp, html: readingRowHtml(reading, zoneId) }));
  const eventEntries = securityEvents.map((event) => ({ timestamp: event.timestamp, html: eventRowHtml(event, zoneId) }));

  timeline.innerHTML = [...readingEntries, ...eventEntries]
    .sort((a, b) => new Date(a.timestamp) - new Date(b.timestamp))
    .map((entry) => entry.html)
    .join('');
}
