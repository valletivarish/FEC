'use strict';

const { ComfortIndexEngine } = require('../fog-environment/comfortIndexEngine');

function reading(zoneId, topic, value, isoTimestamp) {
  return { zoneId, topic, value, timestamp: isoTimestamp };
}

const T0 = '2026-01-01T10:00:00.000Z';

describe('ComfortIndexEngine', () => {
  test('computeComfortIndex is null until temperature, humidity, and co2 have all reported', () => {
    const engine = new ComfortIndexEngine();
    engine.processReading(reading('zone-1', 'temperature', 22, T0));
    expect(engine.computeComfortIndex('zone-1')).toBeNull();
    engine.processReading(reading('zone-1', 'humidity', 45, T0));
    expect(engine.computeComfortIndex('zone-1')).toBeNull();
    engine.processReading(reading('zone-1', 'co2', 500, T0));
    expect(engine.computeComfortIndex('zone-1')).not.toBeNull();
  });

  test('scores 100 when all readings sit inside their comfort bands', () => {
    const engine = new ComfortIndexEngine();
    engine.processReading(reading('zone-1', 'temperature', 22, T0));
    engine.processReading(reading('zone-1', 'humidity', 45, T0));
    engine.processReading(reading('zone-1', 'co2', 500, T0));
    expect(engine.computeComfortIndex('zone-1')).toBe(100);
  });

  test('penalizes readings outside their bands, lowering the comfort index', () => {
    const engine = new ComfortIndexEngine();
    engine.processReading(reading('zone-1', 'temperature', 30, T0));
    engine.processReading(reading('zone-1', 'humidity', 80, T0));
    engine.processReading(reading('zone-1', 'co2', 1500, T0));
    const score = engine.computeComfortIndex('zone-1');
    expect(score).toBeLessThan(100);
    expect(score).toBeGreaterThanOrEqual(0);
  });

  test('raises VENTILATION_POOR when co2 > 1000ppm and zone is occupied', () => {
    const engine = new ComfortIndexEngine({ isZoneScheduledUnoccupied: () => false });
    const events = engine.processReading(reading('zone-1', 'co2', 1100, T0));
    const event = events.find((e) => e.eventType === 'VENTILATION_POOR');
    expect(event).toBeDefined();
    expect(event.zoneId).toBe('zone-1');
  });

  test('does not raise VENTILATION_POOR when zone is scheduled unoccupied', () => {
    const engine = new ComfortIndexEngine({ isZoneScheduledUnoccupied: () => true });
    const events = engine.processReading(reading('zone-1', 'co2', 1100, T0));
    expect(events.find((e) => e.eventType === 'VENTILATION_POOR')).toBeUndefined();
  });

  test('increments WASTE_MINUTES when light-lux exceeds threshold while scheduled unoccupied', () => {
    const engine = new ComfortIndexEngine({ isZoneScheduledUnoccupied: () => true });
    const events = engine.processReading(reading('zone-1', 'light-lux', 200, T0));
    const event = events.find((e) => e.eventType === 'WASTE_MINUTES');
    expect(event).toBeDefined();
    expect(event.payload.wasteMinutesCounter).toBe(1);
  });

  test('does not raise WASTE_MINUTES when light-lux is at or below the low-occupancy threshold', () => {
    const engine = new ComfortIndexEngine({ isZoneScheduledUnoccupied: () => true });
    const events = engine.processReading(reading('zone-1', 'light-lux', 30, T0));
    expect(events.find((e) => e.eventType === 'WASTE_MINUTES')).toBeUndefined();
  });

  test('buildComfortRollupEvents emits COMFORT_OK only for zones with full data', () => {
    const engine = new ComfortIndexEngine();
    engine.processReading(reading('zone-1', 'temperature', 22, T0));
    engine.processReading(reading('zone-1', 'humidity', 45, T0));
    engine.processReading(reading('zone-1', 'co2', 500, T0));
    engine.processReading(reading('zone-2', 'temperature', 22, T0));

    const events = engine.buildComfortRollupEvents(T0);
    expect(events.length).toBe(1);
    expect(events[0].zoneId).toBe('zone-1');
    expect(events[0].eventType).toBe('COMFORT_OK');
  });
});
