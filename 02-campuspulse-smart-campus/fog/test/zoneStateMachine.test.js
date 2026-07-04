'use strict';

const { ZoneStateMachine, STATES } = require('../fog-security/zoneStateMachine');

function reading(zoneId, topic, value, isoTimestamp) {
  return { zoneId, topic, value, timestamp: isoTimestamp };
}

function ts(offsetSeconds) {
  return new Date(Date.UTC(2026, 0, 1, 2, 0, 0) + offsetSeconds * 1000).toISOString();
}

describe('ZoneStateMachine', () => {
  test('IDLE -> DOOR_OPENED on door-contact break', () => {
    const fsm = new ZoneStateMachine('zone-1');
    fsm.handleReading(reading('zone-1', 'door-contact', 0, ts(0)));
    expect(fsm.state).toBe(STATES.DOOR_OPENED);
  });

  test('DOOR_OPENED -> OCCUPIED_ACTIVE when motion occurs within 30s of door open', () => {
    const fsm = new ZoneStateMachine('zone-1');
    fsm.handleReading(reading('zone-1', 'door-contact', 0, ts(0)));
    fsm.handleReading(reading('zone-1', 'motion', 1, ts(10)));
    expect(fsm.state).toBe(STATES.OCCUPIED_ACTIVE);
  });

  test('does not transition to OCCUPIED_ACTIVE when motion arrives after the 30s window', () => {
    const fsm = new ZoneStateMachine('zone-1');
    fsm.handleReading(reading('zone-1', 'door-contact', 0, ts(0)));
    fsm.handleReading(reading('zone-1', 'motion', 1, ts(45)));
    expect(fsm.state).toBe(STATES.DOOR_OPENED);
  });

  test('OCCUPIED_ACTIVE -> LINGERING when motion stops for 60s+', () => {
    const fsm = new ZoneStateMachine('zone-1');
    fsm.handleReading(reading('zone-1', 'door-contact', 0, ts(0)));
    fsm.handleReading(reading('zone-1', 'motion', 1, ts(5)));
    expect(fsm.state).toBe(STATES.OCCUPIED_ACTIVE);
    fsm.checkTimeouts(ts(70));
    expect(fsm.state).toBe(STATES.LINGERING);
  });

  test('OCCUPIED_ACTIVE -> LINGERING when door stays open 2+ minutes even with motion', () => {
    const fsm = new ZoneStateMachine('zone-1');
    fsm.handleReading(reading('zone-1', 'door-contact', 0, ts(0)));
    fsm.handleReading(reading('zone-1', 'motion', 1, ts(5)));
    fsm.handleReading(reading('zone-1', 'motion', 1, ts(100)));
    expect(fsm.state).toBe(STATES.OCCUPIED_ACTIVE);
    fsm.checkTimeouts(ts(125));
    expect(fsm.state).toBe(STATES.LINGERING);
  });

  test('LINGERING -> OCCUPIED_ACTIVE when motion resumes', () => {
    const fsm = new ZoneStateMachine('zone-1');
    fsm.handleReading(reading('zone-1', 'door-contact', 0, ts(0)));
    fsm.handleReading(reading('zone-1', 'motion', 1, ts(5)));
    fsm.checkTimeouts(ts(70));
    expect(fsm.state).toBe(STATES.LINGERING);
    fsm.handleReading(reading('zone-1', 'motion', 1, ts(71)));
    expect(fsm.state).toBe(STATES.OCCUPIED_ACTIVE);
  });

  test('-> CLEARED on door re-close with no motion for 60s, then emits ZONE_CLEARED and resets to IDLE', () => {
    const fsm = new ZoneStateMachine('zone-1');
    fsm.handleReading(reading('zone-1', 'door-contact', 0, ts(0)));
    fsm.handleReading(reading('zone-1', 'motion', 1, ts(5)));
    fsm.checkTimeouts(ts(70));
    expect(fsm.state).toBe(STATES.LINGERING);

    const events = fsm.handleReading(reading('zone-1', 'door-contact', 1, ts(130)));
    const cleared = events.find((e) => e.eventType === 'ZONE_CLEARED');
    expect(cleared).toBeDefined();
    expect(cleared.zoneId).toBe('zone-1');
    expect(fsm.state).toBe(STATES.IDLE);
  });

  test('does not clear when door closes but motion was recent', () => {
    const fsm = new ZoneStateMachine('zone-1');
    fsm.handleReading(reading('zone-1', 'door-contact', 0, ts(0)));
    fsm.handleReading(reading('zone-1', 'motion', 1, ts(5)));
    const events = fsm.handleReading(reading('zone-1', 'door-contact', 1, ts(10)));
    expect(events.find((e) => e.eventType === 'ZONE_CLEARED')).toBeUndefined();
    expect(fsm.state).toBe(STATES.OCCUPIED_ACTIVE);
  });

  test('emits AFTER_HOURS_SECURITY_EVENT on entering OCCUPIED_ACTIVE when after-hours AND sound > 45dB', () => {
    const fsm = new ZoneStateMachine('zone-1', { isAfterHours: () => true });
    fsm.handleReading(reading('zone-1', 'door-contact', 0, ts(0)));
    fsm.handleReading(reading('zone-1', 'sound-level', 60, ts(1)));
    const events = fsm.handleReading(reading('zone-1', 'motion', 1, ts(5)));
    const secEvent = events.find((e) => e.eventType === 'AFTER_HOURS_SECURITY_EVENT');
    expect(secEvent).toBeDefined();
    expect(secEvent.payload.confidence).toBeGreaterThan(0);
    expect(secEvent.payload.confidence).toBeLessThanOrEqual(1);
  });

  test('does not emit AFTER_HOURS_SECURITY_EVENT when after-hours is true but sound <= 45dB', () => {
    const fsm = new ZoneStateMachine('zone-1', { isAfterHours: () => true });
    fsm.handleReading(reading('zone-1', 'door-contact', 0, ts(0)));
    fsm.handleReading(reading('zone-1', 'sound-level', 40, ts(1)));
    const events = fsm.handleReading(reading('zone-1', 'motion', 1, ts(5)));
    expect(events.find((e) => e.eventType === 'AFTER_HOURS_SECURITY_EVENT')).toBeUndefined();
  });

  test('does not emit AFTER_HOURS_SECURITY_EVENT when sound > 45dB but not after-hours', () => {
    const fsm = new ZoneStateMachine('zone-1', { isAfterHours: () => false });
    fsm.handleReading(reading('zone-1', 'door-contact', 0, ts(0)));
    fsm.handleReading(reading('zone-1', 'sound-level', 60, ts(1)));
    const events = fsm.handleReading(reading('zone-1', 'motion', 1, ts(5)));
    expect(events.find((e) => e.eventType === 'AFTER_HOURS_SECURITY_EVENT')).toBeUndefined();
  });

  test('emits AFTER_HOURS_SECURITY_EVENT again on transition into LINGERING under after-hours+sound', () => {
    const fsm = new ZoneStateMachine('zone-1', { isAfterHours: () => true });
    fsm.handleReading(reading('zone-1', 'door-contact', 0, ts(0)));
    fsm.handleReading(reading('zone-1', 'sound-level', 60, ts(1)));
    fsm.handleReading(reading('zone-1', 'motion', 1, ts(5)));
    const events = fsm.checkTimeouts(ts(70));
    const secEvent = events.find((e) => e.eventType === 'AFTER_HOURS_SECURITY_EVENT');
    expect(secEvent).toBeDefined();
    expect(fsm.state).toBe(STATES.LINGERING);
  });
});
