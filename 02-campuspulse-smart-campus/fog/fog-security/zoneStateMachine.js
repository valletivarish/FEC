'use strict';

const MOTION_AFTER_DOOR_WINDOW_MS = 30 * 1000;
const LINGERING_DOOR_OPEN_WINDOW_MS = 2 * 60 * 1000;
const CLEARED_MOTION_QUIET_WINDOW_MS = 60 * 1000;
const AFTER_HOURS_SOUND_THRESHOLD_DB = 45;

const STATES = {
  IDLE: 'IDLE',
  DOOR_OPENED: 'DOOR_OPENED',
  OCCUPIED_ACTIVE: 'OCCUPIED_ACTIVE',
  LINGERING: 'LINGERING',
  CLEARED: 'CLEARED'
};

function defaultIsAfterHours() {
  return false;
}

function toMs(isoTimestamp) {
  return new Date(isoTimestamp).getTime();
}

// Per-zone occupancy FSM: IDLE -> DOOR_OPENED -> OCCUPIED_ACTIVE -> LINGERING -> CLEARED.
// One instance tracks a single zone; the node wrapper keeps a map of these per zoneId.
class ZoneStateMachine {
  constructor(zoneId, options = {}) {
    this.zoneId = zoneId;
    this.isAfterHours = options.isAfterHours || defaultIsAfterHours;
    this.state = STATES.IDLE;
    this.doorOpenedAtMs = null;
    this.lastMotionAtMs = null;
    this.lastSoundLevelDb = null;
    this.doorClosed = true;
  }

  // Central dispatch for every relevant sensor reading; returns an array of fog events (may be empty).
  handleReading(reading) {
    const nowMs = toMs(reading.timestamp);
    if (reading.topic === 'sound-level') {
      this.lastSoundLevelDb = reading.value;
      return this._checkTimeouts(nowMs, reading.timestamp);
    }
    if (reading.topic === 'door-contact') {
      return this._handleDoorContact(reading, nowMs);
    }
    if (reading.topic === 'motion') {
      return this._handleMotion(reading, nowMs);
    }
    return [];
  }

  // Call periodically (independent of new readings) so time-based transitions (LINGERING, CLEARED) still fire.
  checkTimeouts(nowIso) {
    return this._checkTimeouts(toMs(nowIso), nowIso);
  }

  _handleDoorContact(reading, nowMs) {
    const isOpen = reading.value === 0;
    this.doorClosed = !isOpen;

    if (isOpen && this.state === STATES.IDLE) {
      this.state = STATES.DOOR_OPENED;
      this.doorOpenedAtMs = nowMs;
      return [];
    }

    if (!isOpen && this.doorClosed) {
      const noRecentMotion =
        this.lastMotionAtMs === null || nowMs - this.lastMotionAtMs >= CLEARED_MOTION_QUIET_WINDOW_MS;
      if (
        (this.state === STATES.OCCUPIED_ACTIVE || this.state === STATES.LINGERING) &&
        noRecentMotion
      ) {
        return this._transitionToCleared(reading.timestamp);
      }
    }

    return [];
  }

  _handleMotion(reading, nowMs) {
    const events = [];
    if (reading.value === 1) {
      this.lastMotionAtMs = nowMs;

      if (
        this.state === STATES.DOOR_OPENED &&
        this.doorOpenedAtMs !== null &&
        nowMs - this.doorOpenedAtMs <= MOTION_AFTER_DOOR_WINDOW_MS
      ) {
        this.state = STATES.OCCUPIED_ACTIVE;
        events.push(...this._maybeEmitAfterHoursEvent(reading.timestamp));
      } else if (this.state === STATES.LINGERING) {
        this.state = STATES.OCCUPIED_ACTIVE;
        events.push(...this._maybeEmitAfterHoursEvent(reading.timestamp));
      }
    }

    events.push(...this._checkTimeouts(nowMs, reading.timestamp));
    return events;
  }

  // Time-driven transitions: motion-stop -> LINGERING, and door-still-open -> LINGERING.
  _checkTimeouts(nowMs, nowIso) {
    const events = [];

    if (this.state === STATES.OCCUPIED_ACTIVE) {
      const motionStopped =
        this.lastMotionAtMs !== null && nowMs - this.lastMotionAtMs >= CLEARED_MOTION_QUIET_WINDOW_MS;
      const doorStillOpen =
        !this.doorClosed &&
        this.doorOpenedAtMs !== null &&
        nowMs - this.doorOpenedAtMs >= LINGERING_DOOR_OPEN_WINDOW_MS;

      if (motionStopped || doorStillOpen) {
        this.state = STATES.LINGERING;
        events.push(...this._maybeEmitAfterHoursEvent(nowIso));
      }
    }

    return events;
  }

  // Entering OCCUPIED_ACTIVE/LINGERING after hours with elevated sound raises a security event;
  // confidence reflects how many independent signals (door, motion, sound, after-hours) concurred.
  _maybeEmitAfterHoursEvent(nowIso) {
    const afterHours = this.isAfterHours(nowIso);
    const soundElevated =
      this.lastSoundLevelDb !== null && this.lastSoundLevelDb > AFTER_HOURS_SOUND_THRESHOLD_DB;

    if (!afterHours || !soundElevated) {
      return [];
    }

    const signals = [
      !this.doorClosed,
      this.lastMotionAtMs !== null,
      soundElevated,
      afterHours
    ];
    const concurringSignals = signals.filter(Boolean).length;
    const confidence = concurringSignals / signals.length;

    return [{
      zoneId: this.zoneId,
      eventType: 'AFTER_HOURS_SECURITY_EVENT',
      severity: confidence >= 1 ? 'BREACH' : 'WARN',
      payload: {
        state: this.state,
        soundLevelDb: this.lastSoundLevelDb,
        confidence,
        concurringSignals
      },
      timestamp: nowIso
    }];
  }

  _transitionToCleared(nowIso) {
    this.state = STATES.CLEARED;
    const event = {
      zoneId: this.zoneId,
      eventType: 'ZONE_CLEARED',
      severity: 'INFO',
      payload: { previousState: STATES.LINGERING },
      timestamp: nowIso
    };
    // Cleared zones return to idle, ready to detect the next door-open cycle.
    this.state = STATES.IDLE;
    this.doorOpenedAtMs = null;
    this.lastMotionAtMs = null;
    return [event];
  }
}

module.exports = { ZoneStateMachine, STATES };
