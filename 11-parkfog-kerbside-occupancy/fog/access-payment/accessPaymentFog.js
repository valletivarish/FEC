const ANPR_EXEMPT_THRESHOLD = 85;
const OVERSTAY_DEBOUNCE_TICKS = 10;
const ZONE_PRESSURE_ALPHA = 0.3;
const ZONE_PRESSURE_HEARTBEAT_COUNT = 5;

class AccessPaymentFog {
  constructor() {
    this.bays = new Map();
    this.zones = new Map();
  }

  _getBay(bayId) {
    if (!this.bays.has(bayId)) {
      this.bays.set(bayId, {
        purchasedMinutesRemaining: null,
        anprConfidence: null,
        ticksSinceOverstayDispatch: OVERSTAY_DEBOUNCE_TICKS,
      });
    }
    return this.bays.get(bayId);
  }

  _getZone(zoneId) {
    if (!this.zones.has(zoneId)) {
      this.zones.set(zoneId, {
        entryPressureEwma: 0,
        seenFirstSample: false,
        readingCount: 0,
      });
    }
    return this.zones.get(zoneId);
  }

  onReading(reading) {
    const { scope, id, metric } = reading;

    if (scope === 'bay') {
      return this._handleBayReading(id, metric, reading);
    }
    if (scope === 'zone') {
      return this._handleZoneReading(id, metric, reading);
    }
    return [];
  }

  _handleBayReading(bayId, metric, reading) {
    const bay = this._getBay(bayId);

    if (metric === 'anpr-permit-check') {
      bay.anprConfidence = reading.value;
      return [];
    }

    if (metric !== 'meter-payment') {
      return [];
    }

    bay.purchasedMinutesRemaining = reading.value;
    bay.ticksSinceOverstayDispatch += 1;

    const isOverstay = bay.purchasedMinutesRemaining <= 0;
    const isExempt = bay.anprConfidence !== null && bay.anprConfidence >= ANPR_EXEMPT_THRESHOLD;

    if (!isOverstay || isExempt) {
      return [];
    }

    if (bay.ticksSinceOverstayDispatch < OVERSTAY_DEBOUNCE_TICKS) {
      return [];
    }

    bay.ticksSinceOverstayDispatch = 0;

    return [
      {
        type: 'overstay_event',
        bayId,
        purchasedMinutesRemaining: bay.purchasedMinutesRemaining,
        anprConfidence: bay.anprConfidence,
        timestamp: reading.timestamp,
      },
    ];
  }

  _handleZoneReading(zoneId, metric, reading) {
    if (metric !== 'barrier-entry-count' && metric !== 'approach-inbound-count') {
      return [];
    }

    const zone = this._getZone(zoneId);

    if (!zone.seenFirstSample) {
      zone.entryPressureEwma = reading.value;
      zone.seenFirstSample = true;
    } else {
      zone.entryPressureEwma =
        ZONE_PRESSURE_ALPHA * reading.value + (1 - ZONE_PRESSURE_ALPHA) * zone.entryPressureEwma;
    }

    zone.readingCount += 1;

    if (zone.readingCount % ZONE_PRESSURE_HEARTBEAT_COUNT !== 0) {
      return [];
    }

    return [
      {
        type: 'zone_pressure_event',
        zoneId,
        entryPressureEwma: zone.entryPressureEwma,
        timestamp: reading.timestamp,
      },
    ];
  }
}

module.exports = { AccessPaymentFog };
