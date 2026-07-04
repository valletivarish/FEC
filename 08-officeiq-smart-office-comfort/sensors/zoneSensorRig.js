'use strict';

const { publishReading } = require('./mqttPublisher');
const deskOccupancy = require('./generators/deskOccupancyGenerator');
const roomCo2 = require('./generators/roomCo2Generator');
const roomTemperature = require('./generators/roomTemperatureGenerator');
const roomHumidity = require('./generators/roomHumidityGenerator');
const lightLevel = require('./generators/lightLevelGenerator');
const peopleCounter = require('./generators/peopleCounterGenerator');
const plugPower = require('./generators/plugPowerGenerator');
const windowState = require('./generators/windowStateGenerator');
const pressureDifferential = require('./generators/pressureDifferentialGenerator');
const meetingRoomNoise = require('./generators/meetingRoomNoiseGenerator');

// each metric owns its unit and generator so sampling and dispatch stay independently configurable
const METRIC_REGISTRY = {
  'desk-occupancy': { generator: deskOccupancy, unit: 'desks' },
  'room-co2': { generator: roomCo2, unit: 'ppm' },
  'room-temperature': { generator: roomTemperature, unit: 'degC' },
  'room-humidity': { generator: roomHumidity, unit: '%RH' },
  'light-level': { generator: lightLevel, unit: 'lux' },
  'people-counter': { generator: peopleCounter, unit: 'count' },
  'plug-power': { generator: plugPower, unit: 'W' },
  'window-state': { generator: windowState, unit: 'state' },
  'pressure-differential': { generator: pressureDifferential, unit: 'Pa' },
  'meeting-room-noise': { generator: meetingRoomNoise, unit: 'dB' },
};

class ZoneSensorRig {
  constructor(zoneConfig, mqttClient, options = {}) {
    this.zoneId = zoneConfig.zoneId;
    this.zoneConfig = zoneConfig;
    this.mqttClient = mqttClient;
    this.metricRegistry = options.metricRegistry || METRIC_REGISTRY;
    this.publishFn = options.publishFn || publishReading;
    this.sampleTimers = [];
    this.dispatchTimers = [];
    this.latestValues = {};
  }

  start() {
    const sensors = this.zoneConfig.sensors || {};
    for (const metric of Object.keys(sensors)) {
      const entry = this.metricRegistry[metric];
      if (!entry) continue;
      const { sampleFrequencyMs, dispatchRateMs, unit } = sensors[metric];
      const resolvedUnit = unit || entry.unit;

      // sampling and dispatch are separate timers so each rate is independently configurable
      const sampleTimer = setInterval(() => {
        this.latestValues[metric] = entry.generator.nextValue(this.latestValues[metric]);
      }, sampleFrequencyMs);
      this.sampleTimers.push(sampleTimer);

      const dispatchTimer = setInterval(() => {
        if (this.latestValues[metric] === undefined) return;
        const reading = {
          zoneId: this.zoneId,
          metric,
          value: this.latestValues[metric],
          unit: resolvedUnit,
          timestamp: new Date().toISOString(),
        };
        this.publishFn(this.mqttClient, reading);
      }, dispatchRateMs);
      this.dispatchTimers.push(dispatchTimer);
    }
  }

  stop() {
    this.sampleTimers.forEach(clearInterval);
    this.dispatchTimers.forEach(clearInterval);
    this.sampleTimers = [];
    this.dispatchTimers = [];
  }
}

module.exports = { ZoneSensorRig, METRIC_REGISTRY };
