const mqtt = require('mqtt');
const { KerbEventDispatcher } = require('./shared/kerbEventDispatcher');
const { subscribeAll } = require('./shared/sensorSubscriber');
const { BaySensingFog } = require('./bay-sensing/baySensingFog');
const { AccessPaymentFog } = require('./access-payment/accessPaymentFog');
const { KerbConditionsFog } = require('./kerb-conditions/kerbConditionsFog');
const { FogNodeMetrics } = require('./shared/fogNodeMetrics');
const { startMetricsServer } = require('./shared/metricsServer');

// one HTTP port per fog node so the dashboard's Fog Node page can poll each node's own
// real process.cpuUsage()/memoryUsage() self-report independently
const METRICS_PORTS = {
  'bay-sensing-fog': 8111,
  'access-payment-fog': 8112,
  'kerb-conditions-fog': 8113,
};

// metric-to-node routing keeps each fog node focused on its own slice of the sensor contract
const BAY_SENSING_METRICS = new Set([
  'bay-magnetometer',
  'bay-infrared',
  'disabled-bay-badge-scan',
  'camera-free-space-count',
]);
const ACCESS_PAYMENT_METRICS = new Set([
  'meter-payment',
  'anpr-permit-check',
  'barrier-entry-count',
  'approach-inbound-count',
]);
const KERB_CONDITIONS_METRICS = new Set(['kerb-flood-level', 'ev-charge-state']);

async function main() {
  const mqttUrl = process.env.PARKFOG_MQTT_URL || 'mqtt://localhost:1883';
  const apiBaseUrl = process.env.PARKFOG_API_BASE_URL;

  const dispatcher = new KerbEventDispatcher(apiBaseUrl);

  const bayConfig = {
    'bay-05': { isDisabledBay: true },
    'bay-06': { isEvBay: true },
  };

  const baySensingFog = new BaySensingFog(bayConfig);
  const accessPaymentFog = new AccessPaymentFog();
  const kerbConditionsFog = new KerbConditionsFog();

  const metrics = {
    'bay-sensing-fog': new FogNodeMetrics('bay-sensing-fog'),
    'access-payment-fog': new FogNodeMetrics('access-payment-fog'),
    'kerb-conditions-fog': new FogNodeMetrics('kerb-conditions-fog'),
  };

  for (const [nodeName, port] of Object.entries(METRICS_PORTS)) {
    startMetricsServer(port, () => metrics[nodeName].snapshot());
  }

  const mqttClient = mqtt.connect(mqttUrl);

  mqttClient.on('connect', () => {
    subscribeAll(mqttClient, async (reading) => {
      const events = [];

      if (BAY_SENSING_METRICS.has(reading.metric)) {
        const nodeMetrics = metrics['bay-sensing-fog'];
        nodeMetrics.recordReceived();
        const nodeEvents = baySensingFog.onReading(reading);
        nodeMetrics.recordProcessed(reading);
        events.push(...nodeEvents.map((event) => ({ event, nodeName: 'bay-sensing-fog' })));
      }
      if (ACCESS_PAYMENT_METRICS.has(reading.metric)) {
        const nodeMetrics = metrics['access-payment-fog'];
        nodeMetrics.recordReceived();
        const nodeEvents = accessPaymentFog.onReading(reading);
        nodeMetrics.recordProcessed(reading);
        events.push(...nodeEvents.map((event) => ({ event, nodeName: 'access-payment-fog' })));
      }
      if (KERB_CONDITIONS_METRICS.has(reading.metric)) {
        const nodeMetrics = metrics['kerb-conditions-fog'];
        nodeMetrics.recordReceived();
        const nodeEvents = kerbConditionsFog.onReading(reading);
        nodeMetrics.recordProcessed(reading);
        events.push(...nodeEvents.map((event) => ({ event, nodeName: 'kerb-conditions-fog' })));
      }

      for (const { event, nodeName } of events) {
        const dispatched = await dispatcher.dispatch(event);
        if (dispatched) {
          metrics[nodeName].recordSent();
        }
      }
    });
  });

  return { metrics };
}

if (require.main === module) {
  main();
}

module.exports = { main, METRICS_PORTS };
