const { loadZoneConfig } = require('./configLoader');
const { publishReading } = require('./mqttPublisher');

const airTemperatureGenerator = require('./generators/airTemperatureGenerator');
const airHumidityGenerator = require('./generators/airHumidityGenerator');
const co2Generator = require('./generators/co2Generator');
const parLightGenerator = require('./generators/parLightGenerator');
const substrateMoistureGenerator = require('./generators/substrateMoistureGenerator');
const substrateEcGenerator = require('./generators/substrateEcGenerator');
const waterPhGenerator = require('./generators/waterPhGenerator');
const waterTemperatureGenerator = require('./generators/waterTemperatureGenerator');
const ventPositionGenerator = require('./generators/ventPositionGenerator');
const doorContactGenerator = require('./generators/doorContactGenerator');

const METRIC_UNITS = {
  'air-temperature': 'degC',
  'air-humidity': '%RH',
  co2: 'ppm',
  'par-light': 'umol/m2/s',
  'substrate-moisture': '%VWC',
  'substrate-ec': 'mS/cm',
  'water-ph': 'pH',
  'water-temperature': 'degC',
  'vent-position': '%',
  'door-contact': 'boolean'
};

const METRIC_GENERATORS = {
  'air-temperature': airTemperatureGenerator,
  'air-humidity': airHumidityGenerator,
  co2: co2Generator,
  'par-light': parLightGenerator,
  'substrate-moisture': substrateMoistureGenerator,
  'substrate-ec': substrateEcGenerator,
  'water-ph': waterPhGenerator,
  'water-temperature': waterTemperatureGenerator,
  'vent-position': ventPositionGenerator,
  'door-contact': doorContactGenerator
};

const METRICS = Object.keys(METRIC_GENERATORS);

// each metric gets its own sample timer (updates the current value at
// sampleFrequencyMs) and its own dispatch timer (publishes the latest
// value at dispatchRateMs) so the two rates are genuinely independent
class GreenhouseSensorRig {
  constructor(zoneId, mqttClient, config) {
    this.zoneId = zoneId;
    this.mqttClient = mqttClient;
    this.config = config || loadZoneConfig(zoneId);
    this.currentValues = {};
    this.sampleTimers = [];
    this.dispatchTimers = [];
  }

  start() {
    METRICS.forEach((metric) => this._startMetric(metric));
  }

  stop() {
    this.sampleTimers.forEach(clearInterval);
    this.dispatchTimers.forEach(clearInterval);
    this.sampleTimers = [];
    this.dispatchTimers = [];
  }

  _startMetric(metric) {
    const metricConfig = this.config[metric];
    if (!metricConfig) return;

    const generator = METRIC_GENERATORS[metric];
    const sample = () => {
      const timestamp = new Date().toISOString();
      const previousValue = this.currentValues[metric];
      this.currentValues[metric] = generator.nextValue(previousValue, timestamp);
    };
    sample();

    const sampleTimer = setInterval(sample, metricConfig.sampleFrequencyMs);
    this.sampleTimers.push(sampleTimer);

    const dispatch = () => {
      const value = this.currentValues[metric];
      if (value === undefined) return;
      const reading = {
        zoneId: this.zoneId,
        metric,
        value,
        unit: METRIC_UNITS[metric],
        timestamp: new Date().toISOString()
      };
      publishReading(this.mqttClient, reading);
    };
    const dispatchTimer = setInterval(dispatch, metricConfig.dispatchRateMs);
    this.dispatchTimers.push(dispatchTimer);
  }
}

module.exports = { GreenhouseSensorRig, METRICS };
