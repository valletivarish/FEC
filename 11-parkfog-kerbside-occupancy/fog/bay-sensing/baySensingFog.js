const WINDOW_SIZE = 3;
const UP_THRESHOLD = 0.6;
const DOWN_THRESHOLD = 0.4;
const BADGE_SCAN_VIOLATION_TICKS = 20;
// camera counts are trusted for reconciliation only below this occlusion level; a heavily
// occluded frame is expected to disagree with the fused vote and shouldn't raise a false alarm
const CAMERA_TRUST_OCCLUSION_MAX = 25;
// a 1-bay gap is normal camera/sensor noise; only a genuine multi-bay mismatch is worth flagging
const CAMERA_DISCREPANCY_BAY_TOLERANCE = 1;
const CAMERA_DISCREPANCY_DEBOUNCE_TICKS = 3;

class BaySensingFog {
  constructor(bayConfig = {}) {
    this.bayConfig = bayConfig;
    this.bays = new Map();
    this.zones = new Map();
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

  _getZone(zoneId) {
    if (!this.zones.has(zoneId)) {
      this.zones.set(zoneId, { ticksSinceDiscrepancyDispatch: CAMERA_DISCREPANCY_DEBOUNCE_TICKS });
    }
    return this.zones.get(zoneId);
  }

  // cross-validates the camera's zone-wide free-space count against how many bays this node's
  // own magnetometer/infrared fusion currently believes are unoccupied -- a genuine reconciliation
  // between two independent occupancy signals, not a pass-through of the camera reading
  _handleCameraReading(zoneId, reading) {
    if (reading.occlusionPercent > CAMERA_TRUST_OCCLUSION_MAX) {
      return [];
    }

    const fusedAvailable = [...this.bays.values()].filter((b) => b.state === 'UNOCCUPIED').length;
    const gap = Math.abs(reading.value - fusedAvailable);
    const zone = this._getZone(zoneId);
    zone.ticksSinceDiscrepancyDispatch += 1;

    if (gap <= CAMERA_DISCREPANCY_BAY_TOLERANCE) {
      return [];
    }
    if (zone.ticksSinceDiscrepancyDispatch < CAMERA_DISCREPANCY_DEBOUNCE_TICKS) {
      return [];
    }
    zone.ticksSinceDiscrepancyDispatch = 0;

    return [
      {
        type: 'camera_discrepancy_event',
        zoneId,
        cameraFreeCount: reading.value,
        fusedFreeCount: fusedAvailable,
        occlusionPercent: reading.occlusionPercent,
        timestamp: reading.timestamp,
      },
    ];
  }

  onReading(reading) {
    const { scope, id, metric } = reading;

    if (scope === 'zone' && metric === 'camera-free-space-count') {
      return this._handleCameraReading(id, reading);
    }
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
