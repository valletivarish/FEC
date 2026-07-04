'use strict';

const { UsageFog } = require('../fog-usage/deviceLeftOn');

const ZONE = 'zone-101';

function reading(metric, value, timestamp) {
  return { zoneId: ZONE, metric, value, unit: 'x', timestamp };
}

// seeds baseline light + plug power, marks the zone unoccupied, and returns a step function
// that feeds one more idle-with-load tick per call
function setupIdleZone(fog) {
  fog.onReading(reading('desk-occupancy', 0));
  fog.onReading(reading('light-level', 100)); // seeds EWMA baseline
  fog.onReading(reading('plug-power', 50));

  return (tickIndex) => fog.onReading(reading('light-level', 200, `t${tickIndex}`));
}

describe('UsageFog idle-with-load streak', () => {
  test('dispatches DEVICE_LEFT_ON at exactly the 20th consecutive idle tick', () => {
    const fog = new UsageFog();
    const tick = setupIdleZone(fog);

    let events;
    for (let i = 1; i <= 19; i += 1) {
      events = tick(i);
      expect(events).toEqual([]);
    }
    events = tick(20);

    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      type: 'usage_event',
      zoneId: ZONE,
      verdict: 'DEVICE_LEFT_ON',
    });
    expect(events[0].estimatedWattHoursWasted).toBeCloseTo(50 * (20 / 60));
  });

  test('does not re-dispatch DEVICE_LEFT_ON on ticks between 21 and 39', () => {
    const fog = new UsageFog();
    const tick = setupIdleZone(fog);

    for (let i = 1; i <= 20; i += 1) tick(i);
    let sawEvent = false;
    for (let i = 21; i <= 39; i += 1) {
      const events = tick(i);
      if (events.length > 0) sawEvent = true;
    }

    expect(sawEvent).toBe(false);
  });

  test('dispatches DEVICE_LEFT_ON_ESCALATED at the 40th consecutive tick', () => {
    const fog = new UsageFog();
    const tick = setupIdleZone(fog);

    for (let i = 1; i <= 39; i += 1) tick(i);
    const events = tick(40);

    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      type: 'usage_event',
      zoneId: ZONE,
      verdict: 'DEVICE_LEFT_ON_ESCALATED',
    });
    expect(events[0].estimatedWattHoursWasted).toBeCloseTo(50 * (40 / 60));
  });

  test('goes silent again after escalation until the streak resets and re-climbs', () => {
    const fog = new UsageFog();
    const tick = setupIdleZone(fog);

    for (let i = 1; i <= 40; i += 1) tick(i);
    const afterEscalation = tick(41);

    expect(afterEscalation).toEqual([]);
  });

  test('any occupied reading immediately resets the idle streak', () => {
    const fog = new UsageFog();
    const tick = setupIdleZone(fog);

    for (let i = 1; i <= 15; i += 1) tick(i);

    // zone becomes occupied — must clear the streak immediately
    fog.onReading(reading('desk-occupancy', 2));
    fog.onReading(reading('desk-occupancy', 0)); // unoccupied again for subsequent idle checks

    let events;
    for (let i = 1; i <= 19; i += 1) {
      events = tick(i);
      expect(events).toEqual([]);
    }
    events = tick(20);
    expect(events).toHaveLength(1);
    expect(events[0].verdict).toBe('DEVICE_LEFT_ON');
  });

  test('no dispatch when plug-power is at or below 15W even if light is elevated', () => {
    const fog = new UsageFog();
    fog.onReading(reading('desk-occupancy', 0));
    fog.onReading(reading('light-level', 100));
    fog.onReading(reading('plug-power', 15));

    let events = [];
    for (let i = 1; i <= 25; i += 1) {
      events = fog.onReading(reading('light-level', 200, `t${i}`));
    }

    expect(events).toEqual([]);
  });

  test('no dispatch when light-level stays within 1.15x baseline', () => {
    const fog = new UsageFog();
    fog.onReading(reading('desk-occupancy', 0));
    fog.onReading(reading('light-level', 100));
    fog.onReading(reading('plug-power', 50));

    let events = [];
    for (let i = 1; i <= 25; i += 1) {
      events = fog.onReading(reading('light-level', 110, `t${i}`)); // under 1.15x of ~100
    }

    expect(events).toEqual([]);
  });

  test('zones are tracked independently', () => {
    const fog = new UsageFog();
    const tickZone101 = setupIdleZone(fog);
    for (let i = 1; i <= 20; i += 1) tickZone101(i);

    fog.onReading({ zoneId: 'zone-202', metric: 'desk-occupancy', value: 0, unit: 'count' });
    fog.onReading({ zoneId: 'zone-202', metric: 'light-level', value: 100, unit: 'lux' });
    fog.onReading({ zoneId: 'zone-202', metric: 'plug-power', value: 50, unit: 'W' });
    const events = fog.onReading({ zoneId: 'zone-202', metric: 'light-level', value: 200, unit: 'lux', timestamp: 't1' });

    expect(events).toEqual([]);
  });
});
