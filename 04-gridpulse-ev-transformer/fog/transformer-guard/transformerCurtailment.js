const DEESCALATION_STREAK_REQUIRED = 3;

const RUNGS = [
  { rung: 0, label: 'normal', ceilingAmps: null },
  { rung: 1, label: 'advisory', ceilingAmps: 32 * 0.8 },
  { rung: 2, label: 'curtail', ceilingAmps: 32 * 0.4 },
  { rung: 3, label: 'trip', ceilingAmps: 0 },
];

// Highest rung whose threshold the reading meets or exceeds; rung 0 is the default floor.
function rungForLoad(loadAmps) {
  if (loadAmps >= 390) return 3;
  if (loadAmps >= 360) return 2;
  if (loadAmps >= 320) return 1;
  return 0;
}

function rungForTemp(tempC) {
  if (tempC >= 120) return 3;
  if (tempC >= 110) return 2;
  if (tempC >= 100) return 1;
  return 0;
}

class TransformerGuardAgent {
  constructor(bayAgents) {
    this.bayAgents = bayAgents;
    this.currentRung = 0;
    this.latestLoadAmps = null;
    this.latestTempC = null;
    this.lowerRungStreak = 0;
  }

  latestEvSocByBay() {
    const socs = new Map();
    for (const [bayId, agent] of this.bayAgents.entries()) {
      const soc = agent.evSoc.get(bayId);
      if (soc !== undefined) socs.set(bayId, soc);
    }
    return socs;
  }

  lowestSocBayId() {
    const socs = this.latestEvSocByBay();
    let lowestBayId = null;
    let lowestSoc = Infinity;
    for (const [bayId, soc] of socs.entries()) {
      if (soc < lowestSoc) {
        lowestSoc = soc;
        lowestBayId = bayId;
      }
    }
    return lowestBayId;
  }

  applyRungCeilings(rung, shedBayId) {
    const ceiling = RUNGS[rung].ceilingAmps;
    for (const [bayId, agent] of this.bayAgents.entries()) {
      if (rung === 0) {
        agent.applyCurtailmentCeiling(bayId, Infinity);
      } else if (rung === 2 && bayId === shedBayId) {
        agent.applyCurtailmentCeiling(bayId, 0);
      } else {
        agent.applyCurtailmentCeiling(bayId, ceiling);
      }
    }
  }

  onReading(reading) {
    const { hubId, metric, value, timestamp } = reading;
    if (metric === 'transformer/load-amps') {
      this.latestLoadAmps = value;
    } else if (metric === 'transformer/winding-temp') {
      this.latestTempC = value;
    } else {
      return [];
    }

    const loadRung = this.latestLoadAmps === null ? 0 : rungForLoad(this.latestLoadAmps);
    const tempRung = this.latestTempC === null ? 0 : rungForTemp(this.latestTempC);
    const targetRung = Math.max(loadRung, tempRung);

    if (targetRung > this.currentRung) {
      // Escalation is immediate — a single sample past a threshold is enough.
      this.lowerRungStreak = 0;
      return this.transitionTo(targetRung, hubId, timestamp);
    }

    if (targetRung < this.currentRung) {
      this.lowerRungStreak += 1;
      if (this.lowerRungStreak >= DEESCALATION_STREAK_REQUIRED) {
        this.lowerRungStreak = 0;
        return this.transitionTo(targetRung, hubId, timestamp);
      }
      return [];
    }

    this.lowerRungStreak = 0;
    return [];
  }

  transitionTo(newRung, hubId, timestamp) {
    const shedBayId = newRung === 2 ? this.lowestSocBayId() : null;
    this.applyRungCeilings(newRung, shedBayId);
    this.currentRung = newRung;

    const rungDef = RUNGS[newRung];
    const reason = `load=${this.latestLoadAmps ?? 'n/a'}A temp=${this.latestTempC ?? 'n/a'}C`;

    return [{
      type: 'curtailment_event',
      hubId,
      rung: newRung,
      rungLabel: rungDef.label,
      reason,
      shedBayId,
      timestamp,
    }];
  }
}

module.exports = { TransformerGuardAgent };
