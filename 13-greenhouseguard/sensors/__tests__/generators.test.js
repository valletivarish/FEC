const airTemperatureGenerator = require('../generators/airTemperatureGenerator');
const airHumidityGenerator = require('../generators/airHumidityGenerator');
const co2Generator = require('../generators/co2Generator');
const parLightGenerator = require('../generators/parLightGenerator');
const substrateMoistureGenerator = require('../generators/substrateMoistureGenerator');
const substrateEcGenerator = require('../generators/substrateEcGenerator');
const waterPhGenerator = require('../generators/waterPhGenerator');
const waterTemperatureGenerator = require('../generators/waterTemperatureGenerator');
const ventPositionGenerator = require('../generators/ventPositionGenerator');
const doorContactGenerator = require('../generators/doorContactGenerator');

const ITERATIONS = 2000;

function runWalk(generator, min, max, timestamp) {
  let value;
  for (let i = 0; i < ITERATIONS; i += 1) {
    value = generator.nextValue(value, timestamp);
    expect(value).toBeGreaterThanOrEqual(min);
    expect(value).toBeLessThanOrEqual(max);
  }
}

describe('bounded random-walk generators', () => {
  test('air-temperature stays within 5-45 degC', () => {
    runWalk(airTemperatureGenerator, 5, 45, '2026-07-02T12:00:00.000Z');
  });

  test('air-humidity stays within 20-100 %RH', () => {
    runWalk(airHumidityGenerator, 20, 100, '2026-07-02T12:00:00.000Z');
  });

  test('co2 stays within 300-2000 ppm', () => {
    runWalk(co2Generator, 300, 2000, '2026-07-02T12:00:00.000Z');
  });

  test('substrate-moisture stays within 5-60 %VWC', () => {
    runWalk(substrateMoistureGenerator, 5, 60, '2026-07-02T12:00:00.000Z');
  });

  test('substrate-ec stays within 0.2-5 mS/cm', () => {
    runWalk(substrateEcGenerator, 0.2, 5, '2026-07-02T12:00:00.000Z');
  });

  test('water-ph stays within 3.5-9.0', () => {
    runWalk(waterPhGenerator, 3.5, 9.0, '2026-07-02T12:00:00.000Z');
  });

  test('water-temperature stays within 5-35 degC', () => {
    runWalk(waterTemperatureGenerator, 5, 35, '2026-07-02T12:00:00.000Z');
  });

  test('vent-position stays within 0-100 %', () => {
    runWalk(ventPositionGenerator, 0, 100, '2026-07-02T12:00:00.000Z');
  });
});

describe('par-light generator', () => {
  test('stays within 0-2200 umol/m2/s across many iterations at midday', () => {
    let value;
    for (let i = 0; i < ITERATIONS; i += 1) {
      value = parLightGenerator.nextValue(value, '2026-07-02T13:00:00.000Z');
      expect(value).toBeGreaterThanOrEqual(0);
      expect(value).toBeLessThanOrEqual(2200);
    }
  });

  test('is zero outside the 06:00-22:00 daylight window', () => {
    expect(parLightGenerator.nextValue(500, '2026-07-02T02:00:00.000Z')).toBe(0);
    expect(parLightGenerator.nextValue(500, '2026-07-02T23:00:00.000Z')).toBe(0);
  });

  test('is positive and near peak around midday', () => {
    const midday = parLightGenerator.nextValue(0, '2026-07-02T14:00:00.000Z');
    expect(midday).toBeGreaterThan(1000);
  });

  test('is lower near sunrise/sunset than at midday', () => {
    const edge = parLightGenerator.nextValue(0, '2026-07-02T06:30:00.000Z');
    const midday = parLightGenerator.nextValue(0, '2026-07-02T14:00:00.000Z');
    expect(edge).toBeLessThan(midday);
  });
});

describe('door-contact generator', () => {
  test('only ever returns 0 or 1 across many iterations', () => {
    let value;
    for (let i = 0; i < ITERATIONS; i += 1) {
      value = doorContactGenerator.nextValue(value);
      expect([0, 1]).toContain(value);
    }
  });

  test('is closed (0) far more often than open across a long run', () => {
    let value = 0;
    let openCount = 0;
    for (let i = 0; i < ITERATIONS; i += 1) {
      value = doorContactGenerator.nextValue(value);
      if (value === 1) openCount += 1;
    }
    expect(openCount).toBeLessThan(ITERATIONS * 0.5);
  });
});
