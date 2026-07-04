const EWMA_ALPHA = 0.3;
const FULL_CURRENT_AMPS = 32;
const TAPER_FLOOR_AMPS = 6;
const TAPER_START_SOC = 80;
const TAPER_END_SOC = 100;
const SETPOINT_CHANGE_THRESHOLD_AMPS = 1;
const HEARTBEAT_INTERVAL_MS = 60000;

class ChargerBayAgent {
  constructor() {
    this.powerEwma = new Map();
    this.setpointAmps = new Map();
    this.lastDispatchedSetpoint = new Map();
    this.lastDispatchAt = new Map();
    this.curtailmentCeiling = new Map();
    this.connectorState = new Map();
    this.evSoc = new Map();
  }

  // CC-CV-style taper: full current until 80% soc, then linear ramp down to the floor at 100%.
  computeTaperAmps(evSoc) {
    if (evSoc < TAPER_START_SOC) return FULL_CURRENT_AMPS;
    if (evSoc >= TAPER_END_SOC) return TAPER_FLOOR_AMPS;
    const span = TAPER_END_SOC - TAPER_START_SOC;
    const progress = (evSoc - TAPER_START_SOC) / span;
    return FULL_CURRENT_AMPS - progress * (FULL_CURRENT_AMPS - TAPER_FLOOR_AMPS);
  }

  applyCurtailmentCeiling(bayId, ampsCeiling) {
    this.curtailmentCeiling.set(bayId, ampsCeiling);
  }

  recomputeSetpoint(bayId) {
    const state = this.connectorState.get(bayId);
    let amps;
    if (state === 'fault' || state === 'unplugged') {
      amps = 0;
    } else {
      const soc = this.evSoc.get(bayId) ?? 0;
      amps = this.computeTaperAmps(soc);
    }
    const ceiling = this.curtailmentCeiling.get(bayId);
    if (ceiling !== undefined) {
      amps = Math.min(amps, ceiling);
    }
    this.setpointAmps.set(bayId, amps);
    return amps;
  }

  onReading(reading) {
    const { hubId, bayId, metric, value, timestamp } = reading;
    if (!bayId) return [];

    if (metric === 'bay/session-power') {
      const prevEwma = this.powerEwma.get(bayId);
      const nextEwma = prevEwma === undefined ? value : EWMA_ALPHA * value + (1 - EWMA_ALPHA) * prevEwma;
      this.powerEwma.set(bayId, nextEwma);
      return [];
    }

    if (metric === 'bay/connector-state') {
      this.connectorState.set(bayId, value);
    } else if (metric === 'bay/ev-soc') {
      this.evSoc.set(bayId, value);
    } else {
      return [];
    }

    const newSetpoint = this.recomputeSetpoint(bayId);
    const lastDispatched = this.lastDispatchedSetpoint.get(bayId);
    const lastAt = this.lastDispatchAt.get(bayId);
    const changed = lastDispatched === undefined || Math.abs(newSetpoint - lastDispatched) > SETPOINT_CHANGE_THRESHOLD_AMPS;
    const dueForHeartbeat = lastAt !== undefined && (new Date(timestamp) - new Date(lastAt)) >= HEARTBEAT_INTERVAL_MS;

    if (!changed && !dueForHeartbeat) return [];

    this.lastDispatchedSetpoint.set(bayId, newSetpoint);
    this.lastDispatchAt.set(bayId, timestamp);

    return [{
      type: 'bay_setpoint',
      hubId,
      bayId,
      setpointAmps: newSetpoint,
      timestamp,
    }];
  }
}

module.exports = { ChargerBayAgent };
