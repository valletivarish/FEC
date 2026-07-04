'use strict';

const EWMA_ALPHA = 0.1;
const IDLE_LOAD_WATTS = 15;
const BASELINE_MULTIPLIER = 1.15;
const FIRST_THRESHOLD = 20;
const ESCALATED_THRESHOLD = 40;

class UsageFog {
  constructor() {
    this._plugPower = new Map();
    this._lightLevel = new Map();
    this._lightBaseline = new Map();
    this._occupied = new Map();
    this._streak = new Map();
  }

  onReading(reading) {
    const { zoneId, metric, value } = reading;

    if (metric === 'plug-power') {
      this._plugPower.set(zoneId, value);
    } else if (metric === 'light-level') {
      this._lightLevel.set(zoneId, value);
    } else if (metric === 'desk-occupancy') {
      this._occupied.set(zoneId, value > 0);
    } else {
      return [];
    }

    if (metric === 'desk-occupancy' && value > 0) {
      // a single occupied reading clears the idle streak immediately (simplified debounce)
      this._streak.set(zoneId, 0);
      return [];
    }

    if (metric !== 'light-level' && metric !== 'plug-power') {
      return [];
    }

    const plugPower = this._plugPower.get(zoneId);
    const lightLevel = this._lightLevel.get(zoneId);
    const occupied = this._occupied.get(zoneId) || false;

    if (metric === 'light-level' && !this._lightBaseline.has(zoneId)) {
      // seed the EWMA with the first observed reading for this zone
      this._lightBaseline.set(zoneId, value);
    }
    const baseline = this._lightBaseline.get(zoneId);

    if (plugPower === undefined || lightLevel === undefined || baseline === undefined) {
      return [];
    }

    const isIdleWithLoad = !occupied && plugPower > IDLE_LOAD_WATTS && lightLevel > baseline * BASELINE_MULTIPLIER;

    // only let "normal" light levels teach the baseline, or a sustained left-on device
    // would drag its own baseline up and silently escape detection
    if (metric === 'light-level' && !isIdleWithLoad) {
      const prev = this._lightBaseline.get(zoneId);
      this._lightBaseline.set(zoneId, EWMA_ALPHA * value + (1 - EWMA_ALPHA) * prev);
    }

    if (!isIdleWithLoad) {
      this._streak.set(zoneId, 0);
      return [];
    }

    const streak = (this._streak.get(zoneId) || 0) + 1;
    this._streak.set(zoneId, streak);

    const wattHours = plugPower * (streak / 60);

    if (streak === FIRST_THRESHOLD) {
      return [
        {
          type: 'usage_event',
          zoneId,
          verdict: 'DEVICE_LEFT_ON',
          estimatedWattHoursWasted: wattHours,
          plugPower,
          lightLevel,
          timestamp: reading.timestamp,
        },
      ];
    }

    if (streak === ESCALATED_THRESHOLD) {
      return [
        {
          type: 'usage_event',
          zoneId,
          verdict: 'DEVICE_LEFT_ON_ESCALATED',
          estimatedWattHoursWasted: wattHours,
          plugPower,
          lightLevel,
          timestamp: reading.timestamp,
        },
      ];
    }

    return [];
  }
}

module.exports = { UsageFog };
