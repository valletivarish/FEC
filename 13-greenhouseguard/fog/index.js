const mqtt = require('mqtt');
const { GreenhouseEventDispatcher } = require('./shared/greenhouseEventDispatcher');
const { subscribeAll } = require('./shared/sensorSubscriber');
const { ClimateFogNode } = require('./climate-fog/climateFogNode');
const { FertigationFogNode } = require('./fertigation-fog/fertigationFogNode');
const { EnclosureFogNode } = require('./enclosure-fog/enclosureFogNode');
const { FogNodeMetrics } = require('./shared/fogNodeMetrics');
const { startFogMetricsServer } = require('./shared/fogMetricsServer');

const CLIMATE_METRICS = new Set(['air-temperature', 'air-humidity', 'par-light', 'co2']);
const FERTIGATION_METRICS = new Set(['substrate-ec', 'substrate-moisture', 'water-ph', 'water-temperature']);
const ENCLOSURE_METRICS = new Set(['vent-position', 'door-contact']);

function main() {
  const apiBaseUrl = process.env.GREENHOUSEGUARD_API_BASE_URL;
  const dispatcher = new GreenhouseEventDispatcher(apiBaseUrl);

  const climateFogNode = new ClimateFogNode();
  const fertigationFogNode = new FertigationFogNode();
  const enclosureFogNode = new EnclosureFogNode();

  const climateMetrics = new FogNodeMetrics('ClimateFogNode');
  const fertigationMetrics = new FogNodeMetrics('FertigationFogNode');
  const enclosureMetrics = new FogNodeMetrics('EnclosureFogNode');

  const metricsPort = Number(process.env.GREENHOUSEGUARD_FOG_METRICS_PORT) || 4310;
  startFogMetricsServer(
    {
      ClimateFogNode: climateMetrics,
      FertigationFogNode: fertigationMetrics,
      EnclosureFogNode: enclosureMetrics,
    },
    metricsPort
  );

  const mqttClient = mqtt.connect(process.env.MQTT_BROKER_URL || 'mqtt://localhost:1883');

  subscribeAll(mqttClient, (reading) => {
    const { metric } = reading;
    let events = [];
    let metrics = null;

    if (CLIMATE_METRICS.has(metric)) {
      metrics = climateMetrics;
      metrics.recordReceived();
      events = climateFogNode.onReading(reading);
      // the enclosure loop reasons over the climate node's own commands, not raw readings
      for (const event of events) {
        if (event.type === 'setpoint_command') {
          enclosureFogNode.onSetpointCommand(event);
        }
      }
    } else if (FERTIGATION_METRICS.has(metric)) {
      metrics = fertigationMetrics;
      metrics.recordReceived();
      events = fertigationFogNode.onReading(reading);
    } else if (ENCLOSURE_METRICS.has(metric)) {
      metrics = enclosureMetrics;
      metrics.recordReceived();
      events = enclosureFogNode.onReading(reading);
    }

    if (metrics) {
      metrics.recordProcessed(reading, new Date().toISOString());
    }

    for (const event of events) {
      dispatcher.dispatch(event);
      if (metrics) metrics.recordSent();
    }
  });

  return { climateFogNode, fertigationFogNode, enclosureFogNode };
}

if (require.main === module) {
  main();
}

module.exports = { main };
