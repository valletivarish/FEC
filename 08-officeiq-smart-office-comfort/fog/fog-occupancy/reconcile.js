'use strict';

const WINDOW_SIZE = 10;
const STREAK_THRESHOLD = 3;

// Fixed-size rolling window: push and drop-oldest keeps memory bounded per zone.
function pushWindow(window, value) {
  window.push(value);
  if (window.length > WINDOW_SIZE) {
    window.shift();
  }
}

class OccupancyFog {
  constructor() {
    this._deskWindows = new Map();
    this._peopleWindows = new Map();
    // separate streak counters per verdict type so an alternating pattern never accumulates
    this._streaks = new Map();
  }

  _getStreaks(zoneId) {
    if (!this._streaks.has(zoneId)) {
      this._streaks.set(zoneId, { SENSOR_DRIFT: 0, STANDING_ROOM: 0 });
    }
    return this._streaks.get(zoneId);
  }

  onReading(reading) {
    const { zoneId, metric, value } = reading;

    if (metric === 'desk-occupancy') {
      if (!this._deskWindows.has(zoneId)) this._deskWindows.set(zoneId, []);
      pushWindow(this._deskWindows.get(zoneId), value);
    } else if (metric === 'people-counter') {
      if (!this._peopleWindows.has(zoneId)) this._peopleWindows.set(zoneId, []);
      pushWindow(this._peopleWindows.get(zoneId), value);
    } else {
      return [];
    }

    const deskWindow = this._deskWindows.get(zoneId);
    const peopleWindow = this._peopleWindows.get(zoneId);
    if (!deskWindow || !deskWindow.length || !peopleWindow || !peopleWindow.length) {
      return [];
    }

    const deskOccupiedCount = deskWindow[deskWindow.length - 1];
    const netPeopleCount = peopleWindow[peopleWindow.length - 1];
    const diff = deskOccupiedCount - netPeopleCount;

    if (Math.abs(diff) < 3) {
      return [];
    }

    const verdict = diff > 0 ? 'SENSOR_DRIFT' : 'STANDING_ROOM';
    const streaks = this._getStreaks(zoneId);
    streaks[verdict] += 1;
    // the other verdict direction did not occur this tick, so its streak breaks
    const otherVerdict = verdict === 'SENSOR_DRIFT' ? 'STANDING_ROOM' : 'SENSOR_DRIFT';
    streaks[otherVerdict] = 0;

    const resolvedHeadcount =
      streaks[verdict] >= STREAK_THRESHOLD
        ? netPeopleCount
        : Math.round((deskOccupiedCount + netPeopleCount) / 2);

    return [
      {
        type: 'occupancy_event',
        zoneId,
        verdict,
        deskOccupiedCount,
        netPeopleCount,
        resolvedHeadcount,
        timestamp: reading.timestamp,
      },
    ];
  }
}

module.exports = { OccupancyFog };
