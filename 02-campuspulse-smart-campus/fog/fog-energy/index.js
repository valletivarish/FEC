'use strict';

const { subscribeToReadings } = require('../shared/mqttReadingSubscriber');
const { FogDispatcher } = require('../shared/fogDispatcher');
const { NodeMetrics, startMetricsServer } = require('../shared/nodeMetrics');
const { EnergyAnomalyEngine } = require('./energyAnomalyEngine');

const RELEVANT_TOPICS = new Set(['electricity', 'water-flow', 'hvac-duct-pressure']);
const FLUSH_INTERVAL_MS = 60000;
const DEFAULT_METRICS_PORT = 4101;

// Wires the MQTT subscriber into the anomaly engine and dispatches raised events immediately.
function startFogEnergyNode(options = {}) {
  const mqttBrokerUrl = options.mqttBrokerUrl || process.env.MQTT_BROKER_URL || 'mqtt://localhost:1883';
  const apiBaseUrl = options.apiBaseUrl || process.env.API_BASE_URL;
  const metrics = options.metrics || new NodeMetrics('fog-energy');
  const dispatcher = options.dispatcher || new FogDispatcher(apiBaseUrl, {
    onDispatched: () => metrics.recordSent()
  });
  const engine = options.engine || new EnergyAnomalyEngine({
    isZoneScheduledUnoccupied: options.isZoneScheduledUnoccupied
  });

  const client = subscribeToReadings(mqttBrokerUrl, (reading) => {
    if (!RELEVANT_TOPICS.has(reading.topic)) {
      return;
    }
    metrics.recordReceived();
    const events = engine.processReading(reading);
    // Real processing delay: now minus the reading's own sensor timestamp, not a fabricated number.
    metrics.recordProcessed(Date.now() - new Date(reading.timestamp).getTime());
    for (const fogEvent of events) {
      dispatcher.dispatch(fogEvent);
    }
  });

  const flushTimer = setInterval(() => {
    engine.flushIfDue(dispatcher, Date.now(), FLUSH_INTERVAL_MS);
  }, FLUSH_INTERVAL_MS);
  if (typeof flushTimer.unref === 'function') {
    flushTimer.unref();
  }

  const metricsPort = options.metricsPort || Number(process.env.FOG_ENERGY_METRICS_PORT) || DEFAULT_METRICS_PORT;
  const metricsServer = options.skipMetricsServer
    ? null
    : startMetricsServer(metricsPort, metrics, () => dispatcher.fallbackQueue.length);

  return {
    client,
    dispatcher,
    engine,
    metrics,
    metricsServer,
    stop() {
      clearInterval(flushTimer);
      dispatcher.stop();
      client.end();
      if (metricsServer) metricsServer.close();
    }
  };
}

module.exports = { startFogEnergyNode };
