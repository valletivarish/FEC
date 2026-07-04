'use strict';

const TEMP_BAND = { min: 20, max: 24 };
const HUMIDITY_BAND = { min: 30, max: 60 };
const CO2_COMFORT_MAX = 800;
const CO2_VENTILATION_POOR_THRESHOLD = 1000;
const LOW_OCCUPANCY_LUX_THRESHOLD = 50;

// ASHRAE-like weighting: temperature dominates perceived comfort, then humidity, then air quality.
const WEIGHTS = { temperature: 0.45, humidity: 0.30, co2: 0.25 };

function defaultIsZoneScheduledUnoccupied() {
  return false;
}

// Distance-from-band penalty, 0 when inside the band, growing linearly with distance outside it.
function bandPenalty(value, band, scale) {
  if (value < band.min) {
    return Math.min(100, ((band.min - value) / scale) * 100);
  }
  if (value > band.max) {
    return Math.min(100, ((value - band.max) / scale) * 100);
  }
  return 0;
}

function co2Penalty(co2Value) {
  if (co2Value <= CO2_COMFORT_MAX) {
    return 0;
  }
  return Math.min(100, ((co2Value - CO2_COMFORT_MAX) / 1200) * 100);
}

function newZoneState() {
  return {
    temperature: null,
    humidity: null,
    co2: null,
    wasteMinutesCounter: 0
  };
}

// Computes a 0-100 Comfort Index per zone and raises WASTE_MINUTES / VENTILATION_POOR events.
class ComfortIndexEngine {
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

    if (reading.topic === 'temperature') {
      zone.temperature = reading.value;
    } else if (reading.topic === 'humidity') {
      zone.humidity = reading.value;
    } else if (reading.topic === 'co2') {
      zone.co2 = reading.value;
      events.push(...this._checkVentilation(reading));
    } else if (reading.topic === 'light-lux') {
      events.push(...this._checkWaste(reading, zone));
    }

    return events;
  }

  // Occupancy is approximated by "not scheduled unoccupied"; co2 above threshold while occupied is a real air-quality risk.
  _checkVentilation(reading) {
    const events = [];
    const occupied = !this.isZoneScheduledUnoccupied(reading.zoneId);
    if (occupied && reading.value > CO2_VENTILATION_POOR_THRESHOLD) {
      events.push({
        zoneId: reading.zoneId,
        eventType: 'VENTILATION_POOR',
        severity: reading.value > CO2_VENTILATION_POOR_THRESHOLD * 1.5 ? 'BREACH' : 'WARN',
        payload: { co2: reading.value, threshold: CO2_VENTILATION_POOR_THRESHOLD },
        timestamp: reading.timestamp
      });
    }
    return events;
  }

  // Lights on above the low-occupancy threshold while the zone is scheduled unoccupied is pure waste.
  _checkWaste(reading, zone) {
    const events = [];
    const unoccupied = this.isZoneScheduledUnoccupied(reading.zoneId);
    if (unoccupied && reading.value > LOW_OCCUPANCY_LUX_THRESHOLD) {
      zone.wasteMinutesCounter += 1;
      events.push({
        zoneId: reading.zoneId,
        eventType: 'WASTE_MINUTES',
        severity: 'INFO',
        payload: { lightLux: reading.value, wasteMinutesCounter: zone.wasteMinutesCounter },
        timestamp: reading.timestamp
      });
    }
    return events;
  }

  // Null until temperature, humidity, and co2 have all reported at least once for the zone.
  computeComfortIndex(zoneId) {
    const zone = this._getZone(zoneId);
    if (zone.temperature === null || zone.humidity === null || zone.co2 === null) {
      return null;
    }
    const tempPenalty = bandPenalty(zone.temperature, TEMP_BAND, 10);
    const humidityPenalty = bandPenalty(zone.humidity, HUMIDITY_BAND, 40);
    const airPenalty = co2Penalty(zone.co2);

    const weightedPenalty =
      WEIGHTS.temperature * tempPenalty +
      WEIGHTS.humidity * humidityPenalty +
      WEIGHTS.co2 * airPenalty;

    return Math.max(0, Math.round(100 - weightedPenalty));
  }

  // Emitted on the 120s dispatch cadence from the node wrapper, one COMFORT_OK per zone with current readings.
  buildComfortRollupEvents(nowIso) {
    const events = [];
    for (const [zoneId, zone] of this.zones.entries()) {
      const comfortIndex = this.computeComfortIndex(zoneId);
      if (comfortIndex === null) {
        continue;
      }
      events.push({
        zoneId,
        eventType: 'COMFORT_OK',
        severity: comfortIndex < 50 ? 'WARN' : 'INFO',
        payload: {
          comfortIndex,
          temperature: zone.temperature,
          humidity: zone.humidity,
          co2: zone.co2
        },
        timestamp: nowIso
      });
    }
    return events;
  }
}

module.exports = { ComfortIndexEngine };
