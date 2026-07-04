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

function routeReading(reading, bayAgents, transformerGuard, derBalancer, dispatchClient) {
  const { metric } = reading;
  if (!metric) return;
  const category = metric.split('/')[0];

  let events = [];
  if (category === 'bay') {
    const agent = bayAgents.get(reading.bayId);
    if (agent) events = agent.onReading(reading);
  } else if (category === 'transformer') {
    events = transformerGuard.onReading(reading);
  } else if (category === 'der') {
    events = derBalancer.onReading(reading);
  }
  // feeder readings are informational only in this fog layer — no agent consumes them yet.

  for (const event of events) {
    dispatchClient.dispatch(event);
  }
}

function main() {
  const bayAgents = buildBayAgents();
  const transformerGuard = new TransformerGuardAgent(bayAgents);
  const derBalancer = new DerBalancerAgent();

  const kinesisClient = buildKinesisClient();
  const dispatchClient = new KinesisDispatchClient(kinesisClient, STREAM_NAME);

  const mqttClient = mqtt.connect(MQTT_URL);

  mqttClient.on('connect', () => {
    subscribeAll(mqttClient, (reading) => {
      routeReading(reading, bayAgents, transformerGuard, derBalancer, dispatchClient);
    });
  });

  mqttClient.on('error', (err) => {
    console.error('MQTT connection error:', err);
  });

  return { mqttClient, bayAgents, transformerGuard, derBalancer, dispatchClient };
}

if (require.main === module) {
  main();
}

module.exports = { main, routeReading, buildBayAgents };
