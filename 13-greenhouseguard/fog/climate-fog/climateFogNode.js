const VPD_BAND_CENTER_KPA = 1.0;
const VENT_BASELINE_PCT = 50;
const VENT_DEVIATION_GAIN = 80;
const SETPOINT_DELTA_THRESHOLD_PP = 5;
const HEARTBEAT_READING_COUNT = 10;
const DLI_TARGET_MOL = 17;
const DLI_FLAG_HOUR = 18;

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function utcDatePortion(isoTimestamp) {
  return isoTimestamp.slice(0, 10);
}

class ClimateFogNode {
  constructor() {
    this.latestTempByZone = new Map();
    this.latestHumidityByZone = new Map();
    this.lastPublishedSetpointByZone = new Map();
    this.humidityReadingCountByZone = new Map();
    this.dliTotalByZone = new Map();
    this.dliLastDateByZone = new Map();
    this.dliFlaggedTodayByZone = new Map();
    this.previousParReadingByZone = new Map();
  }

  onReading(reading) {
    const { zoneId, metric } = reading;
    if (metric === 'air-temperature') {
      this.latestTempByZone.set(zoneId, reading.value);
      return [];
    }
    if (metric === 'air-humidity') {
      this.latestHumidityByZone.set(zoneId, reading.value);
      return this._handleHumidityReading(zoneId, reading);
    }
    if (metric === 'par-light') {
      return this._handleParReading(zoneId, reading);
    }
    return [];
  }

  _handleHumidityReading(zoneId, reading) {
    const tempC = this.latestTempByZone.get(zoneId);
    const humidityPct = this.latestHumidityByZone.get(zoneId);
    if (tempC === undefined || humidityPct === undefined) {
      return [];
    }

    const count = (this.humidityReadingCountByZone.get(zoneId) || 0) + 1;
    this.humidityReadingCountByZone.set(zoneId, count);

    const svpKpa = 0.61078 * Math.exp((17.27 * tempC) / (tempC + 237.3));
    const vpdKpa = svpKpa * (1 - humidityPct / 100);

    const rawSetpoint = VENT_BASELINE_PCT - (vpdKpa - VPD_BAND_CENTER_KPA) * VENT_DEVIATION_GAIN;
    const ventPositionSetpoint = Math.round(clamp(rawSetpoint, 0, 100));

    const lastPublished = this.lastPublishedSetpointByZone.get(zoneId);
    const isHeartbeat = count % HEARTBEAT_READING_COUNT === 0;
    const deltaExceeded =
      lastPublished === undefined || Math.abs(ventPositionSetpoint - lastPublished) > SETPOINT_DELTA_THRESHOLD_PP;

    if (deltaExceeded || isHeartbeat) {
      this.lastPublishedSetpointByZone.set(zoneId, ventPositionSetpoint);
      return [
        {
          type: 'setpoint_command',
          zoneId,
          ventPositionSetpoint,
          vpdKpa,
          timestamp: reading.timestamp,
        },
      ];
    }

    return [];
  }

  _handleParReading(zoneId, reading) {
    const currentDate = utcDatePortion(reading.timestamp);
    const lastDate = this.dliLastDateByZone.get(zoneId);

    if (lastDate !== undefined && lastDate !== currentDate) {
      this.dliTotalByZone.set(zoneId, 0);
      this.dliFlaggedTodayByZone.set(zoneId, false);
      this.previousParReadingByZone.delete(zoneId);
    }
    this.dliLastDateByZone.set(zoneId, currentDate);

    const previous = this.previousParReadingByZone.get(zoneId);
    let total = this.dliTotalByZone.get(zoneId) || 0;

    if (previous) {
      const secondsBetween = (new Date(reading.timestamp).getTime() - new Date(previous.timestamp).getTime()) / 1000;
      const incrementMol = ((previous.value + reading.value) / 2) * secondsBetween / 1_000_000;
      total += incrementMol;
      this.dliTotalByZone.set(zoneId, total);
    }
    this.previousParReadingByZone.set(zoneId, { value: reading.value, timestamp: reading.timestamp });

    const hourOfDay = new Date(reading.timestamp).getUTCHours();
    const alreadyFlagged = this.dliFlaggedTodayByZone.get(zoneId) || false;

    if (hourOfDay >= DLI_FLAG_HOUR && total < DLI_TARGET_MOL && !alreadyFlagged) {
      this.dliFlaggedTodayByZone.set(zoneId, true);
      return [
        {
          type: 'dli_event',
          zoneId,
          accumulatedDli: total,
          shortfall: true,
          timestamp: reading.timestamp,
        },
      ];
    }

    return [];
  }
}

module.exports = { ClimateFogNode };
