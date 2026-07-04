import { getZoneHistory } from '../apiClient.js';

const LEAK_EVENTS = new Set(['LEAK_SUSPECTED']);
const LOAD_EVENTS = new Set(['LOAD_ANOMALY']);

function splitByTopic(readings) {
  const electricity = readings.filter((reading) => reading.topic === 'electricity');
  const waterFlow = readings.filter((reading) => reading.topic === 'water-flow');
  const hvacDuctPressure = readings.filter((reading) => reading.topic === 'hvac-duct-pressure');
  return { electricity, waterFlow, hvacDuctPressure };
}

function latest(series) {
  return series.length ? series[series.length - 1] : null;
}

function readingRow(label, unit, series, anomalyEvents) {
  const point = latest(series);
  const value = point ? `${point.value} ${unit}` : 'no data';
  const timestamp = point ? point.timestamp : '--';
  const hasAnomaly = anomalyEvents.length > 0;
  return `
    <tr>
      <td>${label}</td>
      <td class="num">${value}</td>
      <td class="num">${timestamp}</td>
      <td>${hasAnomaly
        ? `<span class="badge rounded-pill text-bg-danger">${anomalyEvents[0].eventType}</span>`
        : `<span class="badge rounded-pill text-bg-success">NONE</span>`}</td>
    </tr>
  `;
}

function ductPressureRow(series) {
  const point = latest(series);
  const value = point ? `${point.value.toFixed(1)} Pa` : 'no data';
  const timestamp = point ? point.timestamp : '--';
  return `
    <tr>
      <td>HVAC Duct Pressure</td>
      <td class="num">${value}</td>
      <td class="num">${timestamp}</td>
      <td><span class="badge rounded-pill text-bg-secondary" title="Corroborated by a second sensor signal, increasing confidence this anomaly is real">CORROBORATING</span></td>
    </tr>
  `;
}

export async function renderEnergyPanelView(container, zoneId) {
  container.innerHTML = `
    <section class="section energy-panel card" aria-label="Energy panel">
      <div class="card-body">
        <h2 class="panel-heading card-title h6 text-uppercase text-muted">Energy / ${zoneId}</h2>
        <div class="table-responsive">
          <table class="table table-striped table-hover align-middle">
            <thead>
              <tr>
                <th scope="col">Reading</th>
                <th scope="col">Latest Value</th>
                <th scope="col">Timestamp</th>
                <th scope="col">Anomaly</th>
              </tr>
            </thead>
            <tbody id="energy-readings"></tbody>
          </table>
        </div>
      </div>
    </section>
  `;

  const [electricityHistory, waterHistory, ductPressureHistory] = await Promise.all([
    getZoneHistory(zoneId, 'electricity').catch(() => ({ readings: [], events: [] })),
    getZoneHistory(zoneId, 'water-flow').catch(() => ({ readings: [], events: [] })),
    getZoneHistory(zoneId, 'hvac-duct-pressure').catch(() => ({ readings: [] })),
  ]);

  const { electricity } = splitByTopic(electricityHistory.readings || []);
  const { waterFlow } = splitByTopic(waterHistory.readings || []);
  const { hvacDuctPressure } = splitByTopic(ductPressureHistory.readings || []);

  const leakEvents = (waterHistory.events || []).filter((event) => LEAK_EVENTS.has(event.eventType));
  const loadEvents = (electricityHistory.events || []).filter((event) => LOAD_EVENTS.has(event.eventType));

  container.querySelector('#energy-readings').innerHTML =
    readingRow('Electricity (kWh)', 'kWh', electricity, loadEvents) +
    readingRow('Water Flow (L/min)', 'L/min', waterFlow, leakEvents) +
    ductPressureRow(hvacDuctPressure);
}
