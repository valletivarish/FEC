'use strict';

const { EnergyAnomalyEngine } = require('../fog-energy/energyAnomalyEngine');

function reading(zoneId, topic, value, isoTimestamp) {
  return { zoneId, topic, value, timestamp: isoTimestamp };
}

function ts(offsetSeconds) {
  return new Date(Date.UTC(2026, 0, 1, 0, 0, offsetSeconds)).toISOString();
}

describe('EnergyAnomalyEngine', () => {
  test('does not raise LEAK_SUSPECTED when zone is not scheduled unoccupied', () => {
    const engine = new EnergyAnomalyEngine();
    let events = [];
    for (let i = 0; i < 12; i += 1) {
      events = engine.processReading(reading('zone-1', 'water-flow', 5, ts(i)));
    }
    expect(events.find((e) => e.eventType === 'LEAK_SUSPECTED')).toBeUndefined();
  });

  test('raises LEAK_SUSPECTED after 10+ consecutive positive water-flow samples while unoccupied', () => {
    const engine = new EnergyAnomalyEngine({
      isZoneScheduledUnoccupied: (zoneId) => zoneId === 'zone-1'
    });
    let raised = null;
    for (let i = 0; i < 10; i += 1) {
      const events = engine.processReading(reading('zone-1', 'water-flow', 3.5, ts(i)));
      const leak = events.find((e) => e.eventType === 'LEAK_SUSPECTED');
      if (leak) {
        raised = leak;
      }
    }
    expect(raised).not.toBeNull();
    expect(raised.severity).toBe('BREACH');
    expect(raised.zoneId).toBe('zone-1');
  });

  test('resets the consecutive counter when water-flow drops to zero', () => {
    const engine = new EnergyAnomalyEngine({
      isZoneScheduledUnoccupied: () => true
    });
    for (let i = 0; i < 5; i += 1) {
      engine.processReading(reading('zone-1', 'water-flow', 2, ts(i)));
    }
    engine.processReading(reading('zone-1', 'water-flow', 0, ts(5)));
    let raised = null;
    for (let i = 6; i < 14; i += 1) {
      const events = engine.processReading(reading('zone-1', 'water-flow', 2, ts(i)));
      const leak = events.find((e) => e.eventType === 'LEAK_SUSPECTED');
      if (leak) raised = leak;
    }
    expect(raised).toBeNull();
  });

  test('raises LOAD_ANOMALY when electricity exceeds baseline+3*stddev and hvac-duct-pressure drops', () => {
    const engine = new EnergyAnomalyEngine();

    // Establish a stable electricity + hvac-duct-pressure baseline.
    for (let i = 0; i < 20; i += 1) {
      engine.processReading(reading('zone-2', 'electricity', 10 + (i % 2 === 0 ? 0.1 : -0.1), ts(i)));
      engine.processReading(reading('zone-2', 'hvac-duct-pressure', 200, ts(i)));
    }

    // hvac-duct-pressure drops below its established baseline mean.
    engine.processReading(reading('zone-2', 'hvac-duct-pressure', 150, ts(21)));
    // electricity spikes far beyond baseline+3*stddev.
    const events = engine.processReading(reading('zone-2', 'electricity', 40, ts(22)));

    const anomaly = events.find((e) => e.eventType === 'LOAD_ANOMALY');
    expect(anomaly).toBeDefined();
    expect(anomaly.severity).toEqual(expect.stringMatching(/INFO|WARN|BREACH/));
    expect(anomaly.payload.severityScore).toBeGreaterThanOrEqual(0);
    expect(anomaly.payload.severityScore).toBeLessThanOrEqual(1);
    // hvac-duct-pressure has no dispatch path of its own - it must ride on the anomaly it corroborates.
    // EWMA mean holds at 200 through 20 flat samples, then steps to 200 + 0.3*(150-200) = 185 on the drop.
    expect(anomaly.payload.hvacDuctPressure).toBeCloseTo(185);
  });

  test('does not raise LOAD_ANOMALY when electricity spikes but hvac-duct-pressure does not drop', () => {
    const engine = new EnergyAnomalyEngine();
    for (let i = 0; i < 20; i += 1) {
      engine.processReading(reading('zone-3', 'electricity', 10, ts(i)));
      engine.processReading(reading('zone-3', 'hvac-duct-pressure', 200, ts(i)));
    }
    engine.processReading(reading('zone-3', 'hvac-duct-pressure', 210, ts(21)));
    const events = engine.processReading(reading('zone-3', 'electricity', 40, ts(22)));
    expect(events.find((e) => e.eventType === 'LOAD_ANOMALY')).toBeUndefined();
  });

  test('flushIfDue dispatches a rollup event per zone with readings and resets counters', () => {
    const engine = new EnergyAnomalyEngine();
    const dispatched = [];
    const fakeDispatcher = { dispatch: (event) => dispatched.push(event) };

    engine.processReading(reading('zone-4', 'electricity', 5, ts(0)));
    engine.flushIfDue(fakeDispatcher, 0, 60000);
    expect(dispatched.length).toBe(1);
    expect(dispatched[0].zoneId).toBe('zone-4');

    // Calling again before the interval elapses must not dispatch a second time.
    engine.processReading(reading('zone-4', 'electricity', 5, ts(1)));
    engine.flushIfDue(fakeDispatcher, 30000, 60000);
    expect(dispatched.length).toBe(1);

    engine.flushIfDue(fakeDispatcher, 61000, 60000);
    expect(dispatched.length).toBe(2);
  });

  test('flushIfDue dispatches the latest hvac-duct-pressure mean as a plain reading, not a fog event', () => {
    const engine = new EnergyAnomalyEngine();
    const dispatched = [];
    const fakeDispatcher = { dispatch: (event) => dispatched.push(event) };

    engine.processReading(reading('zone-5', 'electricity', 5, ts(0)));
    engine.processReading(reading('zone-5', 'hvac-duct-pressure', 220, ts(0)));
    engine.flushIfDue(fakeDispatcher, 0, 60000);

    const ductReading = dispatched.find((d) => d.topic === 'hvac-duct-pressure');
    expect(ductReading).toBeDefined();
    expect(ductReading.eventType).toBeUndefined();
    expect(ductReading.zoneId).toBe('zone-5');
    expect(ductReading.value).toBe(220);
  });

  test('flushIfDue does not dispatch a duct-pressure reading when no reading has arrived yet', () => {
    const engine = new EnergyAnomalyEngine();
    const dispatched = [];
    const fakeDispatcher = { dispatch: (event) => dispatched.push(event) };

    engine.processReading(reading('zone-6', 'electricity', 5, ts(0)));
    engine.flushIfDue(fakeDispatcher, 0, 60000);

    expect(dispatched.find((d) => d.topic === 'hvac-duct-pressure')).toBeUndefined();
    expect(dispatched).toHaveLength(1);
  });
});
