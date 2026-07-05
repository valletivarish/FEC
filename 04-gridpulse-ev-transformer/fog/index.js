const mqtt = require('mqtt');
const { KinesisClient } = require('@aws-sdk/client-kinesis');
const { ChargerBayAgent } = require('./bay-agent/chargerBaySetpoint');
const { TransformerGuardAgent } = require('./transformer-guard/transformerCurtailment');
const { DerBalancerAgent } = require('./der-balancer/derDispatchPlanner');
const { KinesisDispatchClient } = require('./shared/kinesisDispatchClient');
const { subscribeAll } = require('./shared/sensorSubscriber');
const { FogNodeMetrics } = require('./shared/fogNodeMetrics');
const { ProcessResourceSampler } = require('./shared/processResourceSampler');
const { startFogStatusServer } = require('./shared/fogStatusServer');

const BAY_IDS = ['bay-01', 'bay-02', 'bay-03', 'bay-04', 'bay-05', 'bay-06'];
const STREAM_NAME = process.env.GRIDPULSE_STREAM_NAME || 'gridpulse-telemetry-stream';
const MQTT_URL = process.env.GRIDPULSE_MQTT_URL || 'mqtt://localhost:1883';
const STATUS_PORT = Number(process.env.GRIDPULSE_FOG_STATUS_PORT || 3010);

// three real fog agent groups, named after this project's own agent classes — not generic "Fog Node N"
const NODE_NAMES = {
  bay: 'ChargerBayAgentFog',
  transformer: 'TransformerGuardFog',
  der: 'DerBalancerFog',
};

function buildNodeMetrics() {
  return {
    bay: new FogNodeMetrics(NODE_NAMES.bay),
    transformer: new FogNodeMetrics(NODE_NAMES.transformer),
    der: new FogNodeMetrics(NODE_NAMES.der),
  };
}

function buildBayAgents() {
  const bayAgents = new Map();
  for (const bayId of BAY_IDS) {
    bayAgents.set(bayId, new ChargerBayAgent());
  }
  return bayAgents;
}

// Region/endpoint intentionally omitted — the SDK reads AWS_REGION/AWS_ENDPOINT_URL from env natively.
function buildKinesisClient() {
  return new KinesisClient({});
}

// category -> which node group's metrics/dispatch a reading of that category belongs to
const CATEGORY_TO_NODE = { bay: 'bay', transformer: 'transformer', feeder: 'transformer', der: 'der' };

function routeReading(reading, bayAgents, transformerGuard, derBalancer, dispatchClient, nodeMetrics = {}) {
  const { metric } = reading;
  if (!metric) return;
  const category = metric.split('/')[0];
  const nodeKey = CATEGORY_TO_NODE[category];
  const metrics = nodeKey && nodeMetrics[nodeKey];

  if (metrics) metrics.recordReceived();

  let events = [];
  if (category === 'bay') {
    const agent = bayAgents.get(reading.bayId);
    if (agent) events = agent.onReading(reading);
  } else if (category === 'transformer' || category === 'feeder') {
    // feeder power quality is TransformerGuardAgent's concern too — same hub-level grid-health scope.
    events = transformerGuard.onReading(reading);
  } else if (category === 'der') {
    events = derBalancer.onReading(reading);
  }

  if (metrics) metrics.recordProcessed();

  for (const event of events) {
    if (metrics) metrics.recordDispatchStart(reading.timestamp);
    dispatchClient.dispatch(event).then(() => {
      if (metrics) metrics.recordDispatchSettled();
    });
  }
}

// snapshot every node's counters plus this single Node process's real resource usage —
// one process hosts all three agent groups, so CPU/memory is reported once, not per-node.
function buildStatusPayload(nodeMetrics, resourceSampler) {
  return {
    nodes: Object.values(nodeMetrics).map((metrics) => metrics.snapshot()),
    process: resourceSampler.sample(),
  };
}

function main() {
  const bayAgents = buildBayAgents();
  const transformerGuard = new TransformerGuardAgent(bayAgents);
  const derBalancer = new DerBalancerAgent();
  const nodeMetrics = buildNodeMetrics();
  const resourceSampler = new ProcessResourceSampler();

  const kinesisClient = buildKinesisClient();
  const dispatchClient = new KinesisDispatchClient(kinesisClient, STREAM_NAME);

  const mqttClient = mqtt.connect(MQTT_URL);

  mqttClient.on('connect', () => {
    subscribeAll(mqttClient, (reading) => {
      routeReading(reading, bayAgents, transformerGuard, derBalancer, dispatchClient, nodeMetrics);
    });
  });

  mqttClient.on('error', (err) => {
    console.error('MQTT connection error:', err);
  });

  const statusServer = startFogStatusServer({
    port: STATUS_PORT,
    getStatus: () => buildStatusPayload(nodeMetrics, resourceSampler),
  });

  return {
    mqttClient, bayAgents, transformerGuard, derBalancer, dispatchClient, nodeMetrics, statusServer,
  };
}

if (require.main === module) {
  main();
}

module.exports = {
  main, routeReading, buildBayAgents, buildNodeMetrics, buildStatusPayload, CATEGORY_TO_NODE,
};
