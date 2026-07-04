'use strict';

const { publishReading } = require('./mqttPublisher');

const bayMagnetometer = require('./generators/bayMagnetometerGenerator');
const bayInfrared = require('./generators/bayInfraredGenerator');
const anprPermitCheck = require('./generators/anprPermitCheckGenerator');
const meterPayment = require('./generators/meterPaymentGenerator');
const evChargeState = require('./generators/evChargeStateGenerator');
const disabledBayBadgeScan = require('./generators/disabledBayBadgeScanGenerator');
const barrierEntryCount = require('./generators/barrierEntryCountGenerator');
const kerbFloodLevel = require('./generators/kerbFloodLevelGenerator');
const approachInboundCount = require('./generators/approachInboundCountGenerator');
const cameraFreeSpaceCount = require('./generators/cameraFreeSpaceCountGenerator');

const BAY_METRIC_GENERATORS = {
  'bay-magnetometer': { generator: bayMagnetometer, unit: 'uT' },
  'bay-infrared': { generator: bayInfrared, unit: 'probability' },
  'anpr-permit-check': { generator: anprPermitCheck, unit: 'percent' },
  'meter-payment': { generator: meterPayment, unit: 'minutes' },
  'ev-charge-state': { generator: evChargeState, unit: 'enum' },
  'disabled-bay-badge-scan': { generator: disabledBayBadgeScan, unit: 'boolean' }
};

const ZONE_METRIC_GENERATORS = {
  'barrier-entry-count': { generator: barrierEntryCount, unit: 'count' },
  'kerb-flood-level': { generator: kerbFloodLevel, unit: 'mm' },
  'approach-inbound-count': { generator: approachInboundCount, unit: 'count' },
  'camera-free-space-count': { generator: cameraFreeSpaceCount, unit: 'count' }
};

// anpr only fires on a simulated vehicle-entry event, so only publish every Nth sample tick
const ANPR_FIRE_EVERY_N_TICKS = 20;

// sampling (generating a fresh value) and dispatch (publishing over MQTT) run on independent
// clocks per the contract, so each metric gets two timers instead of one
class KerbSensorRig {
  constructor(config, mqttClient) {
    this.config = config;
    this.mqttClient = mqttClient;
    this.timers = [];
    this.currentValues = new Map();
    this.anprTickCounts = new Map();
  }

  start() {
    const { bays, zoneId } = this.config;

    for (const bayId of bays) {
      for (const metric of Object.keys(BAY_METRIC_GENERATORS)) {
        this._startBayMetric(bayId, metric);
      }
    }

    for (const metric of Object.keys(ZONE_METRIC_GENERATORS)) {
      this._startZoneMetric(zoneId, metric);
    }

    return this;
  }

  stop() {
    this.timers.forEach((timer) => clearInterval(timer));
    this.timers = [];
  }

  _startBayMetric(bayId, metric) {
    const { generator, unit } = BAY_METRIC_GENERATORS[metric];
    const metricConfig = this.config.bayMetrics[metric];
    const key = `bay:${bayId}:${metric}`;

    const sampleTimer = setInterval(() => {
      const previousValue = this.currentValues.get(key);
      this.currentValues.set(key, generator.nextValue(previousValue));
    }, metricConfig.sampleFrequencyMs);

    const dispatchTimer = setInterval(() => {
      if (metric === 'anpr-permit-check' && !this._shouldFireAnpr(bayId)) {
        return;
      }
      if (!this.currentValues.has(key)) return;

      const reading = {
        scope: 'bay',
        id: bayId,
        metric,
        value: this.currentValues.get(key),
        unit,
        timestamp: new Date().toISOString()
      };

      publishReading(this.mqttClient, reading);
    }, metricConfig.dispatchRateMs);

    this.timers.push(sampleTimer, dispatchTimer);
  }

  _startZoneMetric(zoneId, metric) {
    const { generator, unit } = ZONE_METRIC_GENERATORS[metric];
    const metricConfig = this.config.zoneMetrics[metric];
    const key = `zone:${zoneId}:${metric}`;

    const sampleTimer = setInterval(() => {
      const previousValue = this.currentValues.get(key);
      this.currentValues.set(key, generator.nextValue(previousValue));
    }, metricConfig.sampleFrequencyMs);

    const dispatchTimer = setInterval(() => {
      if (!this.currentValues.has(key)) return;
      const current = this.currentValues.get(key);

      if (metric === 'camera-free-space-count') {
        const reading = {
          scope: 'zone',
          id: zoneId,
          metric,
          value: current.count,
          occlusionPercent: current.occlusionPercent,
          unit,
          timestamp: new Date().toISOString()
        };
        publishReading(this.mqttClient, reading);
        return;
      }

      const reading = {
        scope: 'zone',
        id: zoneId,
        metric,
        value: current,
        unit,
        timestamp: new Date().toISOString()
      };
      publishReading(this.mqttClient, reading);
    }, metricConfig.dispatchRateMs);

    this.timers.push(sampleTimer, dispatchTimer);
  }

  // dispatch sparsely: only every ~20th dispatch tick, standing in for a real vehicle-entry event
  _shouldFireAnpr(bayId) {
    const tickCount = (this.anprTickCounts.get(bayId) || 0) + 1;
    this.anprTickCounts.set(bayId, tickCount);
    return tickCount % ANPR_FIRE_EVERY_N_TICKS === 0;
  }
}

module.exports = { KerbSensorRig, BAY_METRIC_GENERATORS, ZONE_METRIC_GENERATORS };
