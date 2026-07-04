'use strict';

const http = require('http');
const mqtt = require('mqtt');
const { subscribeAll } = require('./shared/sensorSubscriber');
const { ZoneEventDispatcher } = require('./shared/zoneEventDispatcher');
const { NodeMetrics } = require('./shared/nodeMetrics');
const { OccupancyFog } = require('./fog-occupancy/reconcile');
const { ComfortFog } = require('./fog-comfort/ventilationAnomaly');
const { UsageFog } = require('./fog-usage/deviceLeftOn');

// metric-to-node routing mirrors which readings each fog node actually needs to reconcile
const OCCUPANCY_METRICS = new Set(['desk-occupancy', 'people-counter']);
const COMFORT_METRICS = new Set([
  'room-co2',
  'window-state',
  'room-humidity',
  'pressure-differential',
  'room-temperature',
  'meeting-room-noise',
]);
const USAGE_METRICS = new Set(['plug-power', 'light-level', 'desk-occupancy']);

// metric-to-node routing also drives which node's counters see this reading, so per-node
// received/processed/sent/queue/delay reflect only the traffic that node actually handles
const METRICS_BY_NODE = [
  ['occupancyFog', OCCUPANCY_METRICS],
  ['comfortFog', COMFORT_METRICS],
  ['usageFog', USAGE_METRICS],
];

async function routeReading(reading, nodes, dispatcher, metrics) {
  const { metric } = reading;
  const events = [];

  for (const [nodeKey, metricSet] of METRICS_BY_NODE) {
    if (!metricSet.has(metric)) continue;
    const nodeMetrics = metrics && metrics[nodeKey];
    if (nodeMetrics) nodeMetrics.recordReceived();

    const nodeEvents = nodes[nodeKey].onReading(reading);
    if (nodeMetrics) nodeMetrics.recordProcessed();
    events.push({ nodeKey, nodeEvents });
  }

  for (const { nodeKey, nodeEvents } of events) {
    for (const event of nodeEvents) {
      await dispatcher.dispatch(event);
      const nodeMetrics = metrics && metrics[nodeKey];
      if (nodeMetrics) nodeMetrics.recordDispatch(event);
    }
  }
}

// exposes each fog node's real self-reported state so the dashboard can poll it — a browser
// can't read this process's memory directly, so a tiny HTTP endpoint is the only real bridge
function startStatusServer(metrics, port) {
  const server = http.createServer((req, res) => {
    if (req.url !== '/fog/status') {
      res.writeHead(404);
      res.end();
      return;
    }
    const body = JSON.stringify({
      nodes: Object.values(metrics).map((nodeMetrics) => nodeMetrics.snapshot()),
    });
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(body);
  });
  server.listen(port);
  return server;
}

function start() {
  const apiBaseUrl = process.env.OFFICEIQ_API_BASE_URL;
  const mqttUrl = process.env.OFFICEIQ_MQTT_URL || 'mqtt://localhost:1883';
  const statusPort = Number(process.env.OFFICEIQ_FOG_STATUS_PORT || 3100);

  const dispatcher = new ZoneEventDispatcher(apiBaseUrl);
  const nodes = {
    occupancyFog: new OccupancyFog(),
    comfortFog: new ComfortFog(),
    usageFog: new UsageFog(),
  };
  const metrics = {
    occupancyFog: new NodeMetrics('OccupancyFog'),
    comfortFog: new NodeMetrics('ComfortFog'),
    usageFog: new NodeMetrics('UsageFog'),
  };

  const mqttClient = mqtt.connect(mqttUrl);
  mqttClient.on('connect', () => {
    subscribeAll(mqttClient, (reading) => {
      routeReading(reading, nodes, dispatcher, metrics);
    });
  });

  const statusServer = startStatusServer(metrics, statusPort);

  return { mqttClient, dispatcher, nodes, metrics, statusServer };
}

if (require.main === module) {
  start();
}

module.exports = { start, routeReading, startStatusServer };
