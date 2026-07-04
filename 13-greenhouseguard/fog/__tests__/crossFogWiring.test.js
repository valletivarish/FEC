const { ClimateFogNode } = require('../climate-fog/climateFogNode');
const { EnclosureFogNode } = require('../enclosure-fog/enclosureFogNode');

// replicates the RUNTIME WIRING NOTE: ClimateFogNode's setpoint_command output feeds
// EnclosureFogNode.onSetpointCommand directly, in-process, before any cloud dispatch
describe('cross-fog-node wiring: climate setpoint feeds enclosure deviation check', () => {
  test('enclosure node has no commanded setpoint until climate node dispatches one', () => {
    const enclosureFogNode = new EnclosureFogNode();
    const events = enclosureFogNode.onReading({ zoneId: 'zone-a', metric: 'vent-position', value: 20, unit: '%', timestamp: '2026-06-01T10:00:00.000Z' });
    expect(events).toEqual([]);
    expect(enclosureFogNode.commandedSetpointByZone.has('zone-a')).toBe(false);
  });

  test('a climate setpoint_command routed into onSetpointCommand enables enclosure deviation detection', () => {
    const climateFogNode = new ClimateFogNode();
    const enclosureFogNode = new EnclosureFogNode();

    const humidityEvents = climateFogNode.onReading({ zoneId: 'zone-a', metric: 'air-temperature', value: 24, unit: 'degC', timestamp: '2026-06-01T10:00:00.000Z' });
    expect(humidityEvents).toEqual([]);

    const setpointEvents = climateFogNode.onReading({ zoneId: 'zone-a', metric: 'air-humidity', value: 30, unit: '%RH', timestamp: '2026-06-01T10:00:00.000Z' });
    expect(setpointEvents).toHaveLength(1);
    expect(setpointEvents[0].type).toBe('setpoint_command');

    for (const event of setpointEvents) {
      if (event.type === 'setpoint_command') {
        enclosureFogNode.onSetpointCommand(event);
      }
    }

    expect(enclosureFogNode.commandedSetpointByZone.get('zone-a')).toBe(setpointEvents[0].ventPositionSetpoint);

    // now feed a wildly deviating vent-position reading twice to confirm the fault path is live
    const commanded = setpointEvents[0].ventPositionSetpoint;
    const actual = commanded > 50 ? 0 : 100; // guarantee a >15pp deviation regardless of computed setpoint
    enclosureFogNode.onReading({ zoneId: 'zone-a', metric: 'vent-position', value: actual, unit: '%', timestamp: '2026-06-01T10:01:00.000Z' });
    const faultEvents = enclosureFogNode.onReading({ zoneId: 'zone-a', metric: 'vent-position', value: actual, unit: '%', timestamp: '2026-06-01T10:02:00.000Z' });

    expect(faultEvents).toHaveLength(1);
    expect(['VENT_STALL', 'VENT_OVERSHOOT']).toContain(faultEvents[0].faultState);
  });
});
