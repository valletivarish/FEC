'use strict';

const { publishReading } = require('./mqttPublisher');
const baySessionPowerGenerator = require('./generators/baySessionPowerGenerator');
const connectorStateGenerator = require('./generators/connectorStateGenerator');
const evSocGenerator = require('./generators/evSocGenerator');
const transformerWindingTempGenerator = require('./generators/transformerWindingTempGenerator');
const transformerLoadAmpsGenerator = require('./generators/transformerLoadAmpsGenerator');
const feederVoltageGenerator = require('./generators/feederVoltageGenerator');
const feederFrequencyGenerator = require('./generators/feederFrequencyGenerator');
const solarGenerationGenerator = require('./generators/solarGenerationGenerator');
const batterySocGenerator = require('./generators/batterySocGenerator');
const tariffPriceGenerator = require('./generators/tariffPriceGenerator');

// static per-metric wiring: category/unit come from the contract, scope decides bay fan-out
const METRIC_DEFINITIONS = [
  { key: 'bay-session-power', metric: 'session-power', category: 'bay', unit: 'kW', scope: 'bay', generator: baySessionPowerGenerator },
  { key: 'bay-connector-state', metric: 'connector-state', category: 'bay', unit: 'enum', scope: 'bay', generator: connectorStateGenerator },
  { key: 'bay-ev-soc', metric: 'ev-soc', category: 'bay', unit: '%', scope: 'bay', generator: evSocGenerator },
  { key: 'transformer-winding-temp', metric: 'winding-temp', category: 'transformer', unit: 'degC', scope: 'hub', generator: transformerWindingTempGenerator },
  { key: 'transformer-load-amps', metric: 'load-amps', category: 'transformer', unit: 'A', scope: 'hub', generator: transformerLoadAmpsGenerator },
  { key: 'feeder-voltage', metric: 'voltage', category: 'feeder', unit: 'V', scope: 'hub', generator: feederVoltageGenerator },
  { key: 'feeder-frequency', metric: 'frequency', category: 'feeder', unit: 'Hz', scope: 'hub', generator: feederFrequencyGenerator },
  { key: 'der-solar-generation', metric: 'solar-generation', category: 'der', unit: 'kW', scope: 'hub', generator: solarGenerationGenerator },
  { key: 'der-battery-soc', metric: 'battery-soc', category: 'der', unit: '%', scope: 'hub', generator: batterySocGenerator },
  { key: 'der-tariff-price', metric: 'tariff-price', category: 'der', unit: 'pence/kWh', scope: 'hub', generator: tariffPriceGenerator },
];

// wraps one (metric, bay) pair's own sample/dispatch cadence and last-known value
class SensorChannel {
  constructor({ hubId, bayId, definition, sampleFrequencyMs, dispatchRateMs, mqttClient }) {
    this.hubId = hubId;
    this.bayId = bayId;
    this.definition = definition;
    this.sampleFrequencyMs = sampleFrequencyMs;
    this.dispatchRateMs = dispatchRateMs;
    this.mqttClient = mqttClient;
    this.currentValue = null;
    this.lastDispatchAt = null;
    this.sampleTimer = null;
  }

  start() {
    // anchor the dispatch window to start time, not epoch 0, so the first sample doesn't force-fire
    this.lastDispatchAt = Date.now();
    this.sampleTimer = setInterval(() => this.sampleAndMaybeDispatch(), this.sampleFrequencyMs);
  }

  stop() {
    if (this.sampleTimer) clearInterval(this.sampleTimer);
    this.sampleTimer = null;
  }

  sampleAndMaybeDispatch() {
    this.currentValue = this.definition.generator.nextValue(this.currentValue);
    const now = Date.now();
    // dispatchRateMs forces a publish on its own cadence, independent of how often we sample
    if (now - this.lastDispatchAt >= this.dispatchRateMs) {
      this.dispatch(now);
    }
  }

  dispatch(now) {
    const reading = {
      hubId: this.hubId,
      bayId: this.bayId || null,
      metric: this.definition.metric,
      category: this.definition.category,
      value: this.currentValue,
      unit: this.definition.unit,
      timestamp: new Date(now).toISOString(),
    };
    publishReading(this.mqttClient, reading);
    this.lastDispatchAt = now;
  }
}

class ChargingHubSimulator {
  constructor(hubConfig, mqttClient) {
    this.hubId = hubConfig.hubId;
    this.bayIds = hubConfig.bayIds;
    this.sensorConfig = hubConfig.sensors;
    this.mqttClient = mqttClient;
    this.channels = [];
  }

  start() {
    for (const definition of METRIC_DEFINITIONS) {
      const rates = this.sensorConfig[definition.key];
      if (!rates) continue;

      if (definition.scope === 'bay') {
        for (const bayId of this.bayIds) {
          const channel = new SensorChannel({
            hubId: this.hubId,
            bayId,
            definition,
            sampleFrequencyMs: rates.sampleFrequencyMs,
            dispatchRateMs: rates.dispatchRateMs,
            mqttClient: this.mqttClient,
          });
          channel.start();
          this.channels.push(channel);
        }
      } else {
        const channel = new SensorChannel({
          hubId: this.hubId,
          bayId: null,
          definition,
          sampleFrequencyMs: rates.sampleFrequencyMs,
          dispatchRateMs: rates.dispatchRateMs,
          mqttClient: this.mqttClient,
        });
        channel.start();
        this.channels.push(channel);
      }
    }
  }

  stop() {
    for (const channel of this.channels) channel.stop();
    this.channels = [];
  }
}

module.exports = { ChargingHubSimulator, SensorChannel, METRIC_DEFINITIONS };
