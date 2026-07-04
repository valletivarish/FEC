const WINDOW_SIZE = 12;
const MIN_SAMPLES_FOR_SLOPE = 6;
const EC_RANGE = { min: 1.0, max: 3.5 };
const PH_RANGE = { min: 5.5, max: 6.5 };
const EC_WARNING_SLOPE_THRESHOLD = 0.3;
const PH_WARNING_SLOPE_THRESHOLD = 0.4;
const LOW_MOISTURE_THRESHOLD = 15;
// outside this band an EC probe's automatic temperature compensation can no longer be trusted, per standard fertigation practice
const WATER_TEMP_RANGE = { min: 15, max: 28 };

function olsSlope(values) {
  const n = values.length;
  const xMean = (n - 1) / 2;
  const yMean = values.reduce((sum, v) => sum + v, 0) / n;
  let numerator = 0;
  let denominator = 0;
  for (let i = 0; i < n; i++) {
    numerator += (i - xMean) * (values[i] - yMean);
    denominator += (i - xMean) * (i - xMean);
  }
  return denominator === 0 ? 0 : numerator / denominator;
}

class FertigationFogNode {
  constructor() {
    this.ecWindowByZone = new Map();
    this.phWindowByZone = new Map();
    this.lastDispatchedSeverityByZoneMetric = new Map();
    this.latestMoistureByZone = new Map();
    this.latestWaterTempByZone = new Map();
    this.lastDispatchedWaterTempSeverityByZone = new Map();
  }

  onReading(reading) {
    const { zoneId, metric } = reading;
    if (metric === 'substrate-moisture') {
      this.latestMoistureByZone.set(zoneId, reading.value);
      return [];
    }
    if (metric === 'substrate-ec') {
      return this._handleMetricReading(zoneId, 'ec', reading, this.ecWindowByZone, EC_RANGE, EC_WARNING_SLOPE_THRESHOLD, this._ecDoseDirection);
    }
    if (metric === 'water-ph') {
      return this._handleMetricReading(zoneId, 'ph', reading, this.phWindowByZone, PH_RANGE, PH_WARNING_SLOPE_THRESHOLD, this._phDoseDirection);
    }
    if (metric === 'water-temperature') {
      return this._handleWaterTemperatureReading(zoneId, reading);
    }
    return [];
  }

  _isTemperatureCompensationNeeded(zoneId) {
    const waterTempC = this.latestWaterTempByZone.get(zoneId);
    return waterTempC !== undefined && (waterTempC < WATER_TEMP_RANGE.min || waterTempC > WATER_TEMP_RANGE.max);
  }

  // out-of-band water temperature makes EC's automatic temperature compensation unreliable, so it
  // gets its own severity transition dispatch, distinct from the EC/pH probe-drift events above
  _handleWaterTemperatureReading(zoneId, reading) {
    this.latestWaterTempByZone.set(zoneId, reading.value);

    const outOfBand = reading.value < WATER_TEMP_RANGE.min || reading.value > WATER_TEMP_RANGE.max;
    const severity = outOfBand ? 'WARNING' : 'OK';

    const lastDispatched = this.lastDispatchedWaterTempSeverityByZone.get(zoneId);
    if (severity === lastDispatched) {
      return [];
    }
    this.lastDispatchedWaterTempSeverityByZone.set(zoneId, severity);

    return [
      {
        type: 'fertigation_event',
        zoneId,
        metric: 'water-temperature',
        severity,
        value: reading.value,
        slopePerReading: null,
        doseDirection: null,
        temperatureCompensationNeeded: outOfBand,
        lowMoisture: false,
        timestamp: reading.timestamp,
      },
    ];
  }

  _ecDoseDirection(slope) {
    if (slope < 0) return 'increase_ec_dose';
    if (slope > 0) return 'decrease_ec_dose';
    return null;
  }

  _phDoseDirection(slope) {
    if (slope < 0) return 'increase_ph_buffer';
    if (slope > 0) return 'decrease_ph_buffer';
    return null;
  }

  _handleMetricReading(zoneId, metricKey, reading, windowByZone, range, warningSlopeThreshold, doseDirectionFn) {
    if (!windowByZone.has(zoneId)) {
      windowByZone.set(zoneId, []);
    }
    const window = windowByZone.get(zoneId);
    window.push(reading.value);
    if (window.length > WINDOW_SIZE) {
      window.shift();
    }

    const hasEnoughSamples = window.length >= MIN_SAMPLES_FOR_SLOPE;
    const slope = hasEnoughSamples ? olsSlope(window) : null;

    const isCritical = reading.value < range.min || reading.value > range.max;
    const isWarning = !isCritical && hasEnoughSamples && Math.abs(slope) > warningSlopeThreshold;

    let severity;
    if (isCritical) {
      severity = 'CRITICAL';
    } else if (isWarning) {
      severity = 'WARNING';
    } else {
      severity = 'OK';
    }

    const dispatchKey = `${zoneId}:${metricKey}`;
    const lastDispatched = this.lastDispatchedSeverityByZoneMetric.get(dispatchKey);

    if (severity === lastDispatched) {
      return [];
    }

    this.lastDispatchedSeverityByZoneMetric.set(dispatchKey, severity);

    let doseDirection = null;
    if (severity === 'WARNING' || severity === 'CRITICAL') {
      doseDirection = hasEnoughSamples ? doseDirectionFn(slope) : null;
    }

    const latestMoisture = this.latestMoistureByZone.get(zoneId);
    const lowMoisture = latestMoisture !== undefined && latestMoisture < LOW_MOISTURE_THRESHOLD;

    const event = {
      type: 'fertigation_event',
      zoneId,
      metric: metricKey,
      severity,
      value: reading.value,
      slopePerReading: slope,
      doseDirection,
      lowMoisture,
      timestamp: reading.timestamp,
    };

    // EC probes rely on automatic temperature compensation, which is only valid within WATER_TEMP_RANGE
    if (metricKey === 'ec') {
      event.temperatureCompensationNeeded = this._isTemperatureCompensationNeeded(zoneId);
    }

    return [event];
  }
}

module.exports = { FertigationFogNode };
