const { EnclosureFogNode } = require('../enclosure-fog/enclosureFogNode');

function setpointEvent(zoneId, ventPositionSetpoint, timestamp) {
  return { type: 'setpoint_command', zoneId, ventPositionSetpoint, vpdKpa: 1.0, timestamp };
}
function ventReading(zoneId, value, timestamp) {
  return { zoneId, metric: 'vent-position', value, unit: '%', timestamp };
}
function doorReading(zoneId, value, timestamp) {
  return { zoneId, metric: 'door-contact', value, unit: 'bool', timestamp };
}

describe('EnclosureFogNode 2-consecutive-cycle debounce', () => {
  test('a single deviation cycle alone does not dispatch a fault', () => {
    const node = new EnclosureFogNode();
    node.onSetpointCommand(setpointEvent('zone-a', 50, '2026-06-01T10:00:00.000Z'));

    const events = node.onReading(ventReading('zone-a', 20, '2026-06-01T10:01:00.000Z'));
    expect(events).toEqual([]);
  });

  test('dispatches VENT_STALL only after 2 consecutive deviation cycles', () => {
    const node = new EnclosureFogNode();
    node.onSetpointCommand(setpointEvent('zone-a', 50, '2026-06-01T10:00:00.000Z'));

    const first = node.onReading(ventReading('zone-a', 20, '2026-06-01T10:01:00.000Z'));
    expect(first).toEqual([]);

    const second = node.onReading(ventReading('zone-a', 20, '2026-06-01T10:02:00.000Z'));
    expect(second).toHaveLength(1);
    expect(second[0].faultState).toBe('VENT_STALL');
  });

  test('deviation counter resets when a cycle is within tolerance, delaying the fault', () => {
    const node = new EnclosureFogNode();
    node.onSetpointCommand(setpointEvent('zone-a', 50, '2026-06-01T10:00:00.000Z'));

    node.onReading(ventReading('zone-a', 20, '2026-06-01T10:01:00.000Z')); // deviation 30 > 15, counter=1
    node.onReading(ventReading('zone-a', 48, '2026-06-01T10:02:00.000Z')); // deviation 2 <= 15, counter resets to 0
    const events = node.onReading(ventReading('zone-a', 20, '2026-06-01T10:03:00.000Z')); // counter=1 again
    expect(events).toEqual([]);
  });
});

describe('EnclosureFogNode STALL vs OVERSHOOT direction logic', () => {
  test('actual below setpoint by more than 15pp for 2 cycles -> VENT_STALL', () => {
    const node = new EnclosureFogNode();
    node.onSetpointCommand(setpointEvent('zone-a', 50, '2026-06-01T10:00:00.000Z'));
    node.onReading(ventReading('zone-a', 20, '2026-06-01T10:01:00.000Z'));
    const events = node.onReading(ventReading('zone-a', 20, '2026-06-01T10:02:00.000Z'));
    expect(events[0].faultState).toBe('VENT_STALL');
    expect(events[0].ventPositionActual).toBe(20);
    expect(events[0].ventPositionSetpoint).toBe(50);
  });

  test('actual above setpoint by more than 15pp for 2 cycles -> VENT_OVERSHOOT', () => {
    const node = new EnclosureFogNode();
    node.onSetpointCommand(setpointEvent('zone-a', 50, '2026-06-01T10:00:00.000Z'));
    node.onReading(ventReading('zone-a', 80, '2026-06-01T10:01:00.000Z'));
    const events = node.onReading(ventReading('zone-a', 80, '2026-06-01T10:02:00.000Z'));
    expect(events[0].faultState).toBe('VENT_OVERSHOOT');
  });

  test('transitions back to ENCLOSURE_OK the next time deviation is within tolerance', () => {
    const node = new EnclosureFogNode();
    node.onSetpointCommand(setpointEvent('zone-a', 50, '2026-06-01T10:00:00.000Z'));
    node.onReading(ventReading('zone-a', 20, '2026-06-01T10:01:00.000Z'));
    const faultEvents = node.onReading(ventReading('zone-a', 20, '2026-06-01T10:02:00.000Z'));
    expect(faultEvents[0].faultState).toBe('VENT_STALL');

    const recoveryEvents = node.onReading(ventReading('zone-a', 49, '2026-06-01T10:03:00.000Z'));
    expect(recoveryEvents).toHaveLength(1);
    expect(recoveryEvents[0].faultState).toBe('ENCLOSURE_OK');
  });

  test('does not dispatch on every reading while state remains unchanged', () => {
    const node = new EnclosureFogNode();
    node.onSetpointCommand(setpointEvent('zone-a', 50, '2026-06-01T10:00:00.000Z'));
    node.onReading(ventReading('zone-a', 20, '2026-06-01T10:01:00.000Z'));
    node.onReading(ventReading('zone-a', 20, '2026-06-01T10:02:00.000Z'));
    const stillStalled = node.onReading(ventReading('zone-a', 20, '2026-06-01T10:03:00.000Z'));
    expect(stillStalled).toEqual([]);
  });
});

describe('EnclosureFogNode door/setpoint cross-check', () => {
  test('dispatches enclosure_breach_event when door opens while setpoint is below 20', () => {
    const node = new EnclosureFogNode();
    node.onSetpointCommand(setpointEvent('zone-a', 10, '2026-06-01T10:00:00.000Z'));

    const events = node.onReading(doorReading('zone-a', 1, '2026-06-01T10:01:00.000Z'));
    expect(events).toHaveLength(1);
    expect(events[0].type).toBe('enclosure_breach_event');
    expect(events[0].doorOpen).toBe(true);
    expect(events[0].ventPositionSetpoint).toBe(10);
  });

  test('does not dispatch a breach when door opens but setpoint is 20 or above', () => {
    const node = new EnclosureFogNode();
    node.onSetpointCommand(setpointEvent('zone-a', 50, '2026-06-01T10:00:00.000Z'));

    const events = node.onReading(doorReading('zone-a', 1, '2026-06-01T10:01:00.000Z'));
    expect(events).toEqual([]);
  });

  test('a door held continuously open dispatches ENCLOSURE_BREACH only once, not every reading', () => {
    const node = new EnclosureFogNode();
    node.onSetpointCommand(setpointEvent('zone-a', 10, '2026-06-01T10:00:00.000Z'));

    const first = node.onReading(doorReading('zone-a', 1, '2026-06-01T10:01:00.000Z'));
    expect(first).toHaveLength(1);

    const second = node.onReading(doorReading('zone-a', 1, '2026-06-01T10:02:00.000Z'));
    const third = node.onReading(doorReading('zone-a', 1, '2026-06-01T10:03:00.000Z'));
    expect(second).toEqual([]);
    expect(third).toEqual([]);
  });

  test('closing the door clears breachActive silently with no dispatched event', () => {
    const node = new EnclosureFogNode();
    node.onSetpointCommand(setpointEvent('zone-a', 10, '2026-06-01T10:00:00.000Z'));
    node.onReading(doorReading('zone-a', 1, '2026-06-01T10:01:00.000Z'));

    const closeEvents = node.onReading(doorReading('zone-a', 0, '2026-06-01T10:02:00.000Z'));
    expect(closeEvents).toEqual([]);
    expect(node.breachActiveByZone.get('zone-a')).toBe(false);
  });

  test('re-opening after a close dispatches a new breach event', () => {
    const node = new EnclosureFogNode();
    node.onSetpointCommand(setpointEvent('zone-a', 10, '2026-06-01T10:00:00.000Z'));
    node.onReading(doorReading('zone-a', 1, '2026-06-01T10:01:00.000Z'));
    node.onReading(doorReading('zone-a', 0, '2026-06-01T10:02:00.000Z'));

    const reopenEvents = node.onReading(doorReading('zone-a', 1, '2026-06-01T10:03:00.000Z'));
    expect(reopenEvents).toHaveLength(1);
    expect(reopenEvents[0].type).toBe('enclosure_breach_event');
  });

  test('repeated closed readings while already closed dispatch nothing', () => {
    const node = new EnclosureFogNode();
    node.onSetpointCommand(setpointEvent('zone-a', 10, '2026-06-01T10:00:00.000Z'));
    const events = node.onReading(doorReading('zone-a', 0, '2026-06-01T10:01:00.000Z'));
    expect(events).toEqual([]);
  });
});
