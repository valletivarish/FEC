'use strict';

const baySessionPowerGenerator = require('../generators/baySessionPowerGenerator');
const connectorStateGenerator = require('../generators/connectorStateGenerator');
const evSocGenerator = require('../generators/evSocGenerator');
const transformerWindingTempGenerator = require('../generators/transformerWindingTempGenerator');
const transformerLoadAmpsGenerator = require('../generators/transformerLoadAmpsGenerator');
const feederVoltageGenerator = require('../generators/feederVoltageGenerator');
const feederFrequencyGenerator = require('../generators/feederFrequencyGenerator');
const solarGenerationGenerator = require('../generators/solarGenerationGenerator');
const batterySocGenerator = require('../generators/batterySocGenerator');
const tariffPriceGenerator = require('../generators/tariffPriceGenerator');

const ITERATIONS = 5000;

function runWalk(generator, seed) {
  let value = seed;
  const values = [];
  for (let i = 0; i < ITERATIONS; i += 1) {
    value = generator.nextValue(value);
    values.push(value);
  }
  return values;
}

describe('numeric generators stay within contract bounds', () => {
  const numericCases = [
    ['baySessionPowerGenerator', baySessionPowerGenerator, 0, 22, 10],
    ['evSocGenerator', evSocGenerator, 0, 100, 50],
    ['transformerWindingTempGenerator', transformerWindingTempGenerator, 20, 130, 60],
    ['transformerLoadAmpsGenerator', transformerLoadAmpsGenerator, 0, 400, 150],
    ['feederVoltageGenerator', feederVoltageGenerator, 207, 253, 230],
    ['feederFrequencyGenerator', feederFrequencyGenerator, 49.5, 50.5, 50],
    ['solarGenerationGenerator', solarGenerationGenerator, 0, 50, 20],
    ['batterySocGenerator', batterySocGenerator, 5, 100, 50],
    ['tariffPriceGenerator', tariffPriceGenerator, 5, 45, 20],
  ];

  test.each(numericCases)('%s stays within [%s, %s]', (_name, generator, min, max, seed) => {
    const values = runWalk(generator, seed);
    for (const value of values) {
      expect(typeof value).toBe('number');
      expect(Number.isNaN(value)).toBe(false);
      expect(value).toBeGreaterThanOrEqual(min);
      expect(value).toBeLessThanOrEqual(max);
    }
  });

  test('numeric generators also stay bounded from edge-of-range seeds', () => {
    for (const [, generator, min, max] of numericCases) {
      const fromMin = runWalk(generator, min);
      const fromMax = runWalk(generator, max);
      for (const value of [...fromMin, ...fromMax]) {
        expect(value).toBeGreaterThanOrEqual(min);
        expect(value).toBeLessThanOrEqual(max);
      }
    }
  });
});

describe('connectorStateGenerator stays within enum bounds', () => {
  test('only ever produces contract-defined states', () => {
    let value = 'unplugged';
    for (let i = 0; i < ITERATIONS; i += 1) {
      value = connectorStateGenerator.nextValue(value);
      expect(connectorStateGenerator.STATES).toContain(value);
    }
  });

  test('handles an unrecognised previous value by defaulting safely', () => {
    const value = connectorStateGenerator.nextValue('not-a-real-state');
    expect(connectorStateGenerator.STATES).toContain(value);
  });
});
