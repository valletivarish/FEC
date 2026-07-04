'use strict';

const { ComfortFog } = require('../fog-comfort/ventilationAnomaly');

const ZONE = 'zone-101';

function reading(metric, value, timestamp) {
  return { zoneId: ZONE, metric, value, unit: 'x', timestamp };
}

// feeds a rising CO2 ramp (slope > 15/sample) into the 10-sample window, collecting
// every dispatched event since the anomaly can transition active mid-ramp, not just on the last tick
function primeRisingCo2(fog, startTimestamp = 0) {
  const allEvents = [];
  for (let i = 0; i < 10; i += 1) {
    const value = 700 + i * 40; // steep ramp, ends at 1060
    allEvents.push(...fog.onReading(reading('room-co2', value, `t${startTimestamp + i}`)));
  }
  return allEvents;
}

describe('ComfortFog VENTILATION_ANOMALY 4-condition gate', () => {
  test('fires only when all 4 conditions hold simultaneously', () => {
    const fog = new ComfortFog();
    fog.onReading(reading('window-state', 0));
    fog.onReading(reading('desk-occupancy', 3));
    const events = primeRisingCo2(fog);

    const fired = events.filter((e) => e.verdict === 'VENTILATION_ANOMALY');
    expect(fired).toHaveLength(1);
    expect(fired[0].severity).toBe('critical');
  });

  test('does NOT fire with only high CO2 + steep slope + occupied (window open)', () => {
    const fog = new ComfortFog();
    fog.onReading(reading('window-state', 1)); // open, breaks the gate
    fog.onReading(reading('desk-occupancy', 3));
    const events = primeRisingCo2(fog);

    expect(events.filter((e) => e.verdict === 'VENTILATION_ANOMALY')).toHaveLength(0);
  });

  test('does NOT fire with only high CO2 + steep slope + closed window (unoccupied)', () => {
    const fog = new ComfortFog();
    fog.onReading(reading('window-state', 0));
    fog.onReading(reading('desk-occupancy', 0)); // unoccupied, breaks the gate
    const events = primeRisingCo2(fog);

    expect(events.filter((e) => e.verdict === 'VENTILATION_ANOMALY')).toHaveLength(0);
  });

  test('does NOT fire with only closed window + occupied + high CO2 but flat slope', () => {
    const fog = new ComfortFog();
    fog.onReading(reading('window-state', 0));
    fog.onReading(reading('desk-occupancy', 3));
    let events = [];
    for (let i = 0; i < 10; i += 1) {
      // flat high CO2, slope ~0
      events = fog.onReading(reading('room-co2', 1100, `t${i}`));
    }

    expect(events.filter((e) => e.verdict === 'VENTILATION_ANOMALY')).toHaveLength(0);
  });

  test('does NOT fire with steep slope + closed window + occupied but CO2 below 1000', () => {
    const fog = new ComfortFog();
    fog.onReading(reading('window-state', 0));
    fog.onReading(reading('desk-occupancy', 3));
    let events = [];
    for (let i = 0; i < 10; i += 1) {
      const value = 500 + i * 40; // steep ramp but ends at 860, under threshold
      events = fog.onReading(reading('room-co2', value, `t${i}`));
    }

    expect(events.filter((e) => e.verdict === 'VENTILATION_ANOMALY')).toHaveLength(0);
  });

  test('humidity above 60 downgrades severity to elevated but still fires', () => {
    const fog = new ComfortFog();
    fog.onReading(reading('window-state', 0));
    fog.onReading(reading('desk-occupancy', 3));
    fog.onReading(reading('room-humidity', 65));
    const events = primeRisingCo2(fog);

    const fired = events.filter((e) => e.verdict === 'VENTILATION_ANOMALY');
    expect(fired).toHaveLength(1);
    expect(fired[0].severity).toBe('elevated');
  });

  test('humidity at or below 60 keeps severity critical', () => {
    const fog = new ComfortFog();
    fog.onReading(reading('window-state', 0));
    fog.onReading(reading('desk-occupancy', 3));
    fog.onReading(reading('room-humidity', 60));
    const events = primeRisingCo2(fog);

    const fired = events.filter((e) => e.verdict === 'VENTILATION_ANOMALY');
    expect(fired[0].severity).toBe('critical');
  });

  test('transition-gated: does not re-dispatch while still active', () => {
    const fog = new ComfortFog();
    fog.onReading(reading('window-state', 0));
    fog.onReading(reading('desk-occupancy', 3));
    const events = primeRisingCo2(fog);
    expect(events.filter((e) => e.verdict === 'VENTILATION_ANOMALY')).toHaveLength(1);

    // one more still-anomalous reading — must not re-fire
    const again = fog.onReading(reading('room-co2', 1100, 'tNext'));
    expect(again.filter((e) => e.verdict === 'VENTILATION_ANOMALY')).toHaveLength(0);
  });

  test('re-fires after conditions clear and become true again', () => {
    const fog = new ComfortFog();
    fog.onReading(reading('window-state', 0));
    fog.onReading(reading('desk-occupancy', 3));
    primeRisingCo2(fog);

    // clear the condition by opening the window
    fog.onReading(reading('window-state', 1));
    fog.onReading(reading('room-co2', 1150, 'tClearCheck'));

    // close it again and ramp CO2 back up steeply
    fog.onReading(reading('window-state', 0));
    let events = [];
    for (let i = 0; i < 10; i += 1) {
      const value = 700 + i * 40;
      events = fog.onReading(reading('room-co2', value, `t2-${i}`));
    }

    expect(events.filter((e) => e.verdict === 'VENTILATION_ANOMALY')).toHaveLength(1);
  });
});

describe('ComfortFog PRESSURE_FAULT independent check', () => {
  test('fires on pressure alone regardless of CO2/occupancy state', () => {
    const fog = new ComfortFog();
    const events = fog.onReading(reading('pressure-differential', 13));

    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      type: 'comfort_event',
      zoneId: ZONE,
      verdict: 'PRESSURE_FAULT',
      severity: null,
      pressureDifferential: 13,
    });
  });

  test('fires for negative pressure beyond -12 too', () => {
    const fog = new ComfortFog();
    const events = fog.onReading(reading('pressure-differential', -13));

    expect(events).toHaveLength(1);
    expect(events[0].verdict).toBe('PRESSURE_FAULT');
  });

  test('does not fire within +/-12 Pa', () => {
    const fog = new ComfortFog();
    const events = fog.onReading(reading('pressure-differential', 12));

    expect(events).toEqual([]);
  });

  test('transition-gated: no re-dispatch while pressure remains out of range', () => {
    const fog = new ComfortFog();
    const first = fog.onReading(reading('pressure-differential', 14));
    const second = fog.onReading(reading('pressure-differential', 14.5));

    expect(first).toHaveLength(1);
    expect(second).toHaveLength(0);
  });

  test('a pressure fault and a later ventilation transition are each reported on their own call', () => {
    const fog = new ComfortFog();
    fog.onReading(reading('window-state', 0));
    fog.onReading(reading('desk-occupancy', 3));
    for (let i = 0; i < 8; i += 1) {
      fog.onReading(reading('room-co2', 700 + i * 40, `t${i}`));
    }

    const pressureEvents = fog.onReading(reading('pressure-differential', 14, 'tPressure'));
    expect(pressureEvents.map((e) => e.verdict)).toEqual(['PRESSURE_FAULT']);

    const co2Events = fog.onReading(reading('room-co2', 700 + 8 * 40, 't8'));
    expect(co2Events.map((e) => e.verdict)).toEqual(['VENTILATION_ANOMALY']);
  });

  test('a fresh ventilation transition does not re-announce an already-active pressure fault', () => {
    const fog = new ComfortFog();
    fog.onReading(reading('desk-occupancy', 3));
    for (let i = 0; i < 9; i += 1) {
      fog.onReading(reading('room-co2', 700 + i * 40, `t${i}`));
    }
    fog.onReading(reading('pressure-differential', 14, 'tPressure'));

    // closing the window is the single remaining condition for ventilation, and this same
    // onReading call re-evaluates the still-active pressure state alongside it
    const events = fog.onReading(reading('window-state', 0, 'tClose'));
    const verdicts = events.map((e) => e.verdict);
    expect(verdicts).toContain('VENTILATION_ANOMALY');
    // pressure was already active before this call, so per the transition-gating rule it
    // correctly does NOT repeat here — confirming each verdict is gated independently
    expect(verdicts).not.toContain('PRESSURE_FAULT');
  });
});
