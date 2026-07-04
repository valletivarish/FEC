const DEVIATION_THRESHOLD_PP = 15;
const CONSECUTIVE_CYCLES_FOR_FAULT = 2;
const BREACH_SETPOINT_THRESHOLD_PCT = 20;

class EnclosureFogNode {
  constructor() {
    this.commandedSetpointByZone = new Map();
    this.deviationCounterByZone = new Map();
    this.enclosureStateByZone = new Map();
    this.breachActiveByZone = new Map();
  }

  onSetpointCommand(event) {
    this.commandedSetpointByZone.set(event.zoneId, event.ventPositionSetpoint);
  }

  onReading(reading) {
    const { zoneId, metric } = reading;
    if (metric === 'vent-position') {
      return this._handleVentPositionReading(zoneId, reading);
    }
    if (metric === 'door-contact') {
      return this._handleDoorContactReading(zoneId, reading);
    }
    return [];
  }

  _handleVentPositionReading(zoneId, reading) {
    const commandedSetpoint = this.commandedSetpointByZone.get(zoneId);
    if (commandedSetpoint === undefined) {
      return [];
    }

    const actualVentPosition = reading.value;
    const deviation = Math.abs(actualVentPosition - commandedSetpoint);

    let counter = this.deviationCounterByZone.get(zoneId) || 0;
    counter = deviation > DEVIATION_THRESHOLD_PP ? counter + 1 : 0;
    this.deviationCounterByZone.set(zoneId, counter);

    const currentState = this.enclosureStateByZone.get(zoneId) || 'ENCLOSURE_OK';

    if (deviation <= DEVIATION_THRESHOLD_PP) {
      if (currentState !== 'ENCLOSURE_OK') {
        this.enclosureStateByZone.set(zoneId, 'ENCLOSURE_OK');
        return [
          this._faultEvent(zoneId, 'ENCLOSURE_OK', actualVentPosition, commandedSetpoint, reading.timestamp),
        ];
      }
      return [];
    }

    if (counter >= CONSECUTIVE_CYCLES_FOR_FAULT && currentState === 'ENCLOSURE_OK') {
      const faultState = actualVentPosition < commandedSetpoint ? 'VENT_STALL' : 'VENT_OVERSHOOT';
      this.enclosureStateByZone.set(zoneId, faultState);
      return [
        this._faultEvent(zoneId, faultState, actualVentPosition, commandedSetpoint, reading.timestamp),
      ];
    }

    return [];
  }

  _faultEvent(zoneId, faultState, ventPositionActual, ventPositionSetpoint, timestamp) {
    return {
      type: 'enclosure_fault_event',
      zoneId,
      faultState,
      ventPositionActual,
      ventPositionSetpoint,
      timestamp,
    };
  }

  _handleDoorContactReading(zoneId, reading) {
    const isOpen = reading.value === 1;
    const breachActive = this.breachActiveByZone.get(zoneId) || false;
    const commandedSetpoint = this.commandedSetpointByZone.get(zoneId);

    if (isOpen && commandedSetpoint !== undefined && commandedSetpoint < BREACH_SETPOINT_THRESHOLD_PCT && !breachActive) {
      this.breachActiveByZone.set(zoneId, true);
      return [
        {
          type: 'enclosure_breach_event',
          zoneId,
          doorOpen: true,
          ventPositionSetpoint: commandedSetpoint,
          timestamp: reading.timestamp,
        },
      ];
    }

    if (!isOpen && breachActive) {
      this.breachActiveByZone.set(zoneId, false);
      return [];
    }

    return [];
  }
}

module.exports = { EnclosureFogNode };
