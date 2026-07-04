const FLOOD_WINDOW_SIZE = 3;
const EV_FAULT_CONSECUTIVE_THRESHOLD = 15;

function floodBand(averageFloodLevel) {
  if (averageFloodLevel < 50) return 'clear';
  if (averageFloodLevel < 120) return 'caution';
  if (averageFloodLevel <= 200) return 'restricted';
  return 'closed';
}

class KerbConditionsFog {
  constructor() {
    this.zones = new Map();
    this.bays = new Map();
  }

  _getZone(zoneId) {
    if (!this.zones.has(zoneId)) {
      this.zones.set(zoneId, {
        floodWindow: [],
        currentBand: null,
      });
    }
    return this.zones.get(zoneId);
  }

  _getBay(bayId) {
    if (!this.bays.has(bayId)) {
      this.bays.set(bayId, {
        consecutiveFaults: 0,
        faultDispatched: false,
      });
    }
    return this.bays.get(bayId);
  }

  onReading(reading) {
    const { scope, id, metric } = reading;

    if (scope === 'zone' && metric === 'kerb-flood-level') {
      return this._handleFloodReading(id, reading);
    }
    if (scope === 'bay' && metric === 'ev-charge-state') {
      return this._handleEvChargeReading(id, reading);
    }
    return [];
  }

  _handleFloodReading(zoneId, reading) {
    const zone = this._getZone(zoneId);

    zone.floodWindow.push(reading.value);
    if (zone.floodWindow.length > FLOOD_WINDOW_SIZE) {
      zone.floodWindow.shift();
    }

    if (zone.floodWindow.length < FLOOD_WINDOW_SIZE) {
      return [];
    }

    const averageFloodLevel =
      zone.floodWindow.reduce((sum, v) => sum + v, 0) / zone.floodWindow.length;
    const band = floodBand(averageFloodLevel);

    if (band === zone.currentBand) {
      return [];
    }
    zone.currentBand = band;

    return [
      {
        type: 'flood_risk_event',
        zoneId,
        band,
        averageFloodLevel,
        timestamp: reading.timestamp,
      },
    ];
  }

  _handleEvChargeReading(bayId, reading) {
    const bay = this._getBay(bayId);

    if (reading.value !== 'fault') {
      bay.consecutiveFaults = 0;
      bay.faultDispatched = false;
      return [];
    }

    bay.consecutiveFaults += 1;

    if (bay.consecutiveFaults < EV_FAULT_CONSECUTIVE_THRESHOLD || bay.faultDispatched) {
      return [];
    }

    bay.faultDispatched = true;

    return [
      {
        type: 'ev_fault_event',
        bayId,
        timestamp: reading.timestamp,
      },
    ];
  }
}

module.exports = { KerbConditionsFog };
