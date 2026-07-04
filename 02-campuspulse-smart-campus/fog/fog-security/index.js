'use strict';

const { subscribeToReadings } = require('../shared/mqttReadingSubscriber');
const { FogDispatcher } = require('../shared/fogDispatcher');
const { NodeMetrics, startMetricsServer } = require('../shared/nodeMetrics');
const { ZoneStateMachine } = require('./zoneStateMachine');

const RELEVANT_TOPICS = new Set(['door-contact', 'motion', 'sound-level']);
const TIMEOUT_CHECK_INTERVAL_MS = 5000;
const DEFAULT_METRICS_PORT = 4103;

// Wires the MQTT subscriber into per-zone FSMs; every state transition dispatches immediately.
function startFogSecurityNode(options = {}) {
  const mqttBrokerUrl = options.mqttBrokerUrl || process.env.MQTT_BROKER_URL || 'mqtt://localhost:1883';
  const apiBaseUrl = options.apiBaseUrl || process.env.API_BASE_URL;
  const metrics = options.metrics || new NodeMetrics('fog-security');
  const dispatcher = options.dispatcher || new FogDispatcher(apiBaseUrl, {
    onDispatched: () => metrics.recordSent()
  });
  const isAfterHours = options.isAfterHours;
  const zoneMachines = options.zoneMachines || new Map();

  function getMachine(zoneId) {
    if (!zoneMachines.has(zoneId)) {
      zoneMachines.set(zoneId, new ZoneStateMachine(zoneId, { isAfterHours }));
    }
    return zoneMachines.get(zoneId);
  }

  const client = subscribeToReadings(mqttBrokerUrl, (reading) => {
    if (!RELEVANT_TOPICS.has(reading.topic)) {
      return;
    }
    metrics.recordReceived();
    const machine = getMachine(reading.zoneId);
    const events = machine.handleReading(reading);
    metrics.recordProcessed(Date.now() - new Date(reading.timestamp).getTime());
    for (const fogEvent of events) {
      dispatcher.dispatch(fogEvent);
    }
  });

  // Motion-stop and door-still-open transitions are time-driven, not reading-driven, so poll for them.
  const timeoutTimer = setInterval(() => {
    const nowIso = new Date().toISOString();
    for (const machine of zoneMachines.values()) {
      const events = machine.checkTimeouts(nowIso);
      for (const fogEvent of events) {
        dispatcher.dispatch(fogEvent);
      }
    }
  }, TIMEOUT_CHECK_INTERVAL_MS);
  if (typeof timeoutTimer.unref === 'function') {
    timeoutTimer.unref();
  }

  const metricsPort = options.metricsPort || Number(process.env.FOG_SECURITY_METRICS_PORT) || DEFAULT_METRICS_PORT;
  const metricsServer = options.skipMetricsServer
    ? null
    : startMetricsServer(metricsPort, metrics, () => dispatcher.fallbackQueue.length);

  return {
    client,
    dispatcher,
    zoneMachines,
    metrics,
    metricsServer,
    stop() {
      clearInterval(timeoutTimer);
      dispatcher.stop();
      client.end();
      if (metricsServer) metricsServer.close();
    }
  };
}

module.exports = { startFogSecurityNode };
