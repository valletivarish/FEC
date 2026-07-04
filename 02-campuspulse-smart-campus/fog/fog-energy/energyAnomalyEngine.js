'use strict';

const EWMA_ALPHA = 0.3;
const LEAK_MIN_CONSECUTIVE_SAMPLES = 10;
const LOAD_ANOMALY_STDDEV_MULTIPLIER = 3;

function defaultIsZoneScheduledUnoccupied() {
  return false;
}

// One tracker per zone per metric: EWMA mean/variance plus rollup counters.
function newMetricState() {
  return { mean: null, variance: 0, sampleCount: 0 };
}

function newZoneState() {
  return {
    electricity: newMetricState(),
    waterFlow: newMetricState(),
    hvacDuctPressure: newMetricState(),
    consecutiveWaterFlowPositive: 0,
    rollup: { electricityReadings: 0, waterFlowReadings: 0, anomaliesRaised: 0 }
  };
}

// Standard EWMA mean/variance update; variance uses the EWMA-of-squared-deviation approximation.
function updateEwma(state, value) {
  if (state.mean === null) {
    state.mean = value;
    state.variance = 0;
  } else {
    const delta = value - state.mean;
    state.mean += EWMA_ALPHA * delta;
    state.variance = (1 - EWMA_ALPHA) * (state.variance + EWMA_ALPHA * delta * delta);
  }
  state.sampleCount += 1;
}

function stddev(state) {
  return Math.sqrt(state.variance);
}

function zScore(state, value) {
  const sd = stddev(state);
  if (sd === 0) {
    return 0;
  }
  return (value - state.mean) / sd;
}

// Tracks 15-min EWMA baselines per zone and raises LEAK_SUSPECTED / LOAD_ANOMALY events.
class EnergyAnomalyEngine {
  constructor(options = {}) {
    this.isZoneScheduledUnoccupied =
      options.isZoneScheduledUnoccupied || defaultIsZoneScheduledUnoccupied;
    this.zones = new Map();
  }

  _getZone(zoneId) {
    if (!this.zones.has(zoneId)) {
      this.zones.set(zoneId, newZoneState());
    }
    return this.zones.get(zoneId);
  }

  // Feeds one reading in; returns an array of fog events raised by this reading (may be empty).
  processReading(reading) {
    const zone = this._getZone(reading.zoneId);
    const events = [];

    if (reading.topic === 'electricity') {
      events.push(...this._processElectricity(reading, zone));
    } else if (reading.topic === 'water-flow') {
      events.push(...this._processWaterFlow(reading, zone));
    } else if (reading.topic === 'hvac-duct-pressure') {
      this._processHvacDuctPressure(reading, zone);
    }

    return events;
  }

  _processHvacDuctPressure(reading, zone) {
    // Capture baseline mean before updating, so "dropped below baseline" reflects the prior window.
    const priorMean = zone.hvacDuctPressure.mean;
    updateEwma(zone.hvacDuctPressure, reading.value);
    zone.hvacDuctPressureDroppedBelowBaseline =
      priorMean !== null && reading.value < priorMean;
  }

  _processElectricity(reading, zone) {
    const events = [];
    const priorMean = zone.electricity.mean;
    const priorSd = stddev(zone.electricity);
    updateEwma(zone.electricity, reading.value);
    zone.rollup.electricityReadings += 1;

    const hvacBaselineReady = zone.hvacDuctPressure.mean !== null;
    if (priorMean !== null && hvacBaselineReady) {
      const z = zScore({ mean: priorMean, variance: priorSd * priorSd }, reading.value);
      const overThreshold = reading.value > priorMean + LOAD_ANOMALY_STDDEV_MULTIPLIER * priorSd;
      const hvacDropped = zone.hvacDuctPressureDroppedBelowBaseline === true;

      if (overThreshold && hvacDropped) {
        const severity = Math.min(1, Math.abs(z) / (LOAD_ANOMALY_STDDEV_MULTIPLIER * 2));
        zone.rollup.anomaliesRaised += 1;
        events.push({
          zoneId: reading.zoneId,
          eventType: 'LOAD_ANOMALY',
          severity: severity >= 0.66 ? 'BREACH' : severity >= 0.33 ? 'WARN' : 'INFO',
          payload: {
            value: reading.value,
            baselineMean: priorMean,
            baselineStddev: priorSd,
            zScore: z,
            severityScore: severity,
            // Rides along since it's the corroborating signal that triggered this anomaly.
            hvacDuctPressure: zone.hvacDuctPressure.mean
          },
          timestamp: reading.timestamp
        });
      }
    }

    return events;
  }

  _processWaterFlow(reading, zone) {
    const events = [];
    updateEwma(zone.waterFlow, reading.value);
    zone.rollup.waterFlowReadings += 1;

    if (reading.value > 0) {
      zone.consecutiveWaterFlowPositive += 1;
    } else {
      zone.consecutiveWaterFlowPositive = 0;
    }

    const unoccupied = this.isZoneScheduledUnoccupied(reading.zoneId);
    if (unoccupied && zone.consecutiveWaterFlowPositive >= LEAK_MIN_CONSECUTIVE_SAMPLES) {
      zone.rollup.anomaliesRaised += 1;
      events.push({
        zoneId: reading.zoneId,
        eventType: 'LEAK_SUSPECTED',
        severity: 'BREACH',
        payload: {
          value: reading.value,
          consecutiveSamples: zone.consecutiveWaterFlowPositive
        },
        timestamp: reading.timestamp
      });
      // Reset so we do not re-raise on every subsequent sample while still unoccupied.
      zone.consecutiveWaterFlowPositive = 0;
    }

    return events;
  }

  // Called by the node wrapper on a timer; only dispatches when 60s have actually elapsed.
  flushIfDue(dispatcher, nowMs = Date.now(), intervalMs = 60000) {
    if (this._lastFlush !== undefined && nowMs - this._lastFlush < intervalMs) {
      return;
    }
    this._lastFlush = nowMs;
    const isoNow = new Date(nowMs).toISOString();
    for (const [zoneId, zone] of this.zones.entries()) {
      if (zone.rollup.electricityReadings === 0 && zone.rollup.waterFlowReadings === 0) {
        continue;
      }
      dispatcher.dispatch({
        zoneId,
        eventType: 'LOAD_ANOMALY',
        severity: 'INFO',
        payload: { rollup: { ...zone.rollup } },
        timestamp: isoNow
      });
      // Plain reading shape (no eventType) so readingWriterHandler routes it into
      // CampusPulseReadings, not the severity-gated alerts table - it's telemetry, not an alert.
      if (zone.hvacDuctPressure.mean !== null) {
        dispatcher.dispatch({
          zoneId,
          topic: 'hvac-duct-pressure',
          value: zone.hvacDuctPressure.mean,
          timestamp: isoNow
        });
      }
      zone.rollup = { electricityReadings: 0, waterFlowReadings: 0, anomaliesRaised: 0 };
    }
  }
}

module.exports = { EnergyAnomalyEngine };
