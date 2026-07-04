'use strict';

const { subscribeToReadings } = require('../shared/mqttReadingSubscriber');
const { FogDispatcher } = require('../shared/fogDispatcher');
const { NodeMetrics, startMetricsServer } = require('../shared/nodeMetrics');
const { ComfortIndexEngine } = require('./comfortIndexEngine');

const RELEVANT_TOPICS = new Set(['temperature', 'humidity', 'co2', 'light-lux']);
const DISPATCH_INTERVAL_MS = 120000;
const DEFAULT_METRICS_PORT = 4102;

// Wires the MQTT subscriber into the comfort engine; WASTE_MINUTES/VENTILATION_POOR dispatch immediately,
// COMFORT_OK rollups dispatch on a 120s cadence.
function startFogEnvironmentNode(options = {}) {
  const mqttBrokerUrl = options.mqttBrokerUrl || process.env.MQTT_BROKER_URL || 'mqtt://localhost:1883';
  const apiBaseUrl = options.apiBaseUrl || process.env.API_BASE_URL;
  const metrics = options.metrics || new NodeMetrics('fog-environment');
  const dispatcher = options.dispatcher || new FogDispatcher(apiBaseUrl, {
    onDispatched: () => metrics.recordSent()
  });
  const engine = options.engine || new ComfortIndexEngine({
    isZoneScheduledUnoccupied: options.isZoneScheduledUnoccupied
  });

  const client = subscribeToReadings(mqttBrokerUrl, (reading) => {
    if (!RELEVANT_TOPICS.has(reading.topic)) {
      return;
    }
    metrics.recordReceived();
    const events = engine.processReading(reading);
    metrics.recordProcessed(Date.now() - new Date(reading.timestamp).getTime());
    for (const fogEvent of events) {
      dispatcher.dispatch(fogEvent);
    }
  });

  const dispatchTimer = setInterval(() => {
    const nowIso = new Date().toISOString();
    for (const fogEvent of engine.buildComfortRollupEvents(nowIso)) {
      dispatcher.dispatch(fogEvent);
    }
  }, DISPATCH_INTERVAL_MS);
  if (typeof dispatchTimer.unref === 'function') {
    dispatchTimer.unref();
  }

  const metricsPort = options.metricsPort || Number(process.env.FOG_ENVIRONMENT_METRICS_PORT) || DEFAULT_METRICS_PORT;
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
      clearInterval(dispatchTimer);
      dispatcher.stop();
      client.end();
      if (metricsServer) metricsServer.close();
    }
  };
}

module.exports = { startFogEnvironmentNode };
