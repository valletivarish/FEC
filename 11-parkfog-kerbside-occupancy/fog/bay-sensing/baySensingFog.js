const WINDOW_SIZE = 3;
const UP_THRESHOLD = 0.6;
const DOWN_THRESHOLD = 0.4;
const BADGE_SCAN_VIOLATION_TICKS = 20;

class BaySensingFog {
  constructor(bayConfig = {}) {
    this.bayConfig = bayConfig;
    this.bays = new Map();
  }

  _getBay(bayId) {
    if (!this.bays.has(bayId)) {
      this.bays.set(bayId, {
        lastMagnetometerSignal: 0,
        lastInfraredSignal: 0,
        voteWindow: [],
        state: 'UNOCCUPIED',
        ticksSinceBadgeScan: 0,
        pendingViolation: false,
      });
    }
    return this.bays.get(bayId);
  }

  onReading(reading) {
    const { scope, id, metric } = reading;
    if (scope !== 'bay') return [];

    const bay = this._getBay(id);
    const isDisabledBay = !!(this.bayConfig[id] && this.bayConfig[id].isDisabledBay);

    if (metric === 'disabled-bay-badge-scan') {
      if (isDisabledBay && reading.value === true) {
        bay.ticksSinceBadgeScan = 0;
      }
      return [];
    }

    if (metric !== 'bay-magnetometer' && metric !== 'bay-infrared') {
      return [];
    }

    if (metric === 'bay-magnetometer') {
      bay.lastMagnetometerSignal = Math.abs(reading.value) > 40 ? 1 : 0;
    } else {
      bay.lastInfraredSignal = reading.value;
    }

    // countdown advances per occupancy tick so it mirrors real elapsed time since the last scan
    if (isDisabledBay) {
      bay.ticksSinceBadgeScan += 1;
    }

    const vote = bay.lastMagnetometerSignal * 0.6 + bay.lastInfraredSignal * 0.4;
    bay.voteWindow.push(vote);
    if (bay.voteWindow.length > WINDOW_SIZE) {
      bay.voteWindow.shift();
    }

    const windowAverage =
      bay.voteWindow.reduce((sum, v) => sum + v, 0) / bay.voteWindow.length;

    const previousState = bay.state;
    if (previousState === 'UNOCCUPIED' && windowAverage > UP_THRESHOLD) {
      bay.state = 'OCCUPIED';
    } else if (previousState === 'OCCUPIED' && windowAverage < DOWN_THRESHOLD) {
      bay.state = 'UNOCCUPIED';
    }

    if (bay.state === previousState) {
      return [];
    }

    // violation onset is flagged only when the transition lands on OCCUPIED past the badge window
    if (
      isDisabledBay &&
      bay.state === 'OCCUPIED' &&
      bay.ticksSinceBadgeScan > BADGE_SCAN_VIOLATION_TICKS
    ) {
      bay.pendingViolation = true;
    }

    const disabledBayViolation = bay.pendingViolation;
    bay.pendingViolation = false;

    return [
      {
        type: 'bay_state_event',
        bayId: id,
        state: bay.state,
        fusedVote: vote,
        disabledBayViolation,
        timestamp: reading.timestamp,
      },
    ];
  }
}

module.exports = { BaySensingFog };
