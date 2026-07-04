'use strict';

const WINDOW_SIZE = 10;
const CO2_THRESHOLD = 1000;
const SLOPE_THRESHOLD = 15;
const HUMIDITY_THRESHOLD = 60;
const PRESSURE_THRESHOLD = 12;

function pushWindow(window, value) {
  window.push(value);
  if (window.length > WINDOW_SIZE) {
    window.shift();
  }
}

// simple linear regression slope (ppm per sample index) over the current window
function computeSlope(window) {
  const n = window.length;
  if (n < 2) return 0;

  let sumX = 0;
  let sumY = 0;
  let sumXY = 0;
  let sumXX = 0;
  for (let i = 0; i < n; i += 1) {
    sumX += i;
    sumY += window[i];
    sumXY += i * window[i];
    sumXX += i * i;
  }

  const denominator = n * sumXX - sumX * sumX;
  if (denominator === 0) return 0;
  return (n * sumXY - sumX * sumY) / denominator;
}

class ComfortFog {
  constructor() {
    this._co2Windows = new Map();
    this._latest = new Map();
    // active-state tracking is what makes both verdicts transition-gated instead of re-firing every tick
    this._active = new Map();
  }

  _getLatest(zoneId) {
    if (!this._latest.has(zoneId)) {
      this._latest.set(zoneId, {
        windowState: null,
        occupied: false,
        humidity: null,
        pressureDifferential: null,
        temperature: null,
        noiseLevel: null,
      });
    }
    return this._latest.get(zoneId);
  }

  _getActive(zoneId) {
    if (!this._active.has(zoneId)) {
      this._active.set(zoneId, { VENTILATION_ANOMALY: false, PRESSURE_FAULT: false });
    }
    return this._active.get(zoneId);
  }

  onReading(reading) {
    const { zoneId, metric, value } = reading;
    const latest = this._getLatest(zoneId);
    const active = this._getActive(zoneId);
    const events = [];

    if (metric === 'room-co2') {
      if (!this._co2Windows.has(zoneId)) this._co2Windows.set(zoneId, []);
      pushWindow(this._co2Windows.get(zoneId), value);
    } else if (metric === 'window-state') {
      latest.windowState = value;
    } else if (metric === 'desk-occupancy') {
      latest.occupied = value > 0;
    } else if (metric === 'room-humidity') {
      latest.humidity = value;
    } else if (metric === 'pressure-differential') {
      latest.pressureDifferential = value;
    } else if (metric === 'room-temperature') {
      latest.temperature = value;
    } else if (metric === 'meeting-room-noise') {
      latest.noiseLevel = value;
    } else {
      return [];
    }

    const co2Window = this._co2Windows.get(zoneId) || [];
    const co2Slope = computeSlope(co2Window);
    const latestCo2 = co2Window.length ? co2Window[co2Window.length - 1] : null;

    const ventilationConditionsMet =
      latestCo2 !== null &&
      latestCo2 > CO2_THRESHOLD &&
      co2Slope > SLOPE_THRESHOLD &&
      latest.windowState === 0 &&
      latest.occupied;

    if (ventilationConditionsMet && !active.VENTILATION_ANOMALY) {
      active.VENTILATION_ANOMALY = true;
      const severity = latest.humidity !== null && latest.humidity > HUMIDITY_THRESHOLD ? 'elevated' : 'critical';
      events.push({
        type: 'comfort_event',
        zoneId,
        verdict: 'VENTILATION_ANOMALY',
        severity,
        co2Slope,
        roomCo2: latestCo2,
        pressureDifferential: latest.pressureDifferential,
        humidity: latest.humidity,
        windowState: latest.windowState,
        temperature: latest.temperature,
        noiseLevel: latest.noiseLevel,
        timestamp: reading.timestamp,
      });
    } else if (!ventilationConditionsMet && active.VENTILATION_ANOMALY) {
      active.VENTILATION_ANOMALY = false;
    }

    const pressureConditionMet =
      latest.pressureDifferential !== null && Math.abs(latest.pressureDifferential) > PRESSURE_THRESHOLD;

    if (pressureConditionMet && !active.PRESSURE_FAULT) {
      active.PRESSURE_FAULT = true;
      events.push({
        type: 'comfort_event',
        zoneId,
        verdict: 'PRESSURE_FAULT',
        severity: null,
        co2Slope,
        roomCo2: latestCo2,
        pressureDifferential: latest.pressureDifferential,
        humidity: latest.humidity,
        windowState: latest.windowState,
        temperature: latest.temperature,
        noiseLevel: latest.noiseLevel,
        timestamp: reading.timestamp,
      });
    } else if (!pressureConditionMet && active.PRESSURE_FAULT) {
      active.PRESSURE_FAULT = false;
    }

    return events;
  }
}

module.exports = { ComfortFog };
