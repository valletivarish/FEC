'use strict';

const deskOccupancy = require('../generators/deskOccupancyGenerator');
const roomCo2 = require('../generators/roomCo2Generator');
const roomTemperature = require('../generators/roomTemperatureGenerator');
const roomHumidity = require('../generators/roomHumidityGenerator');
const lightLevel = require('../generators/lightLevelGenerator');
const peopleCounter = require('../generators/peopleCounterGenerator');
const plugPower = require('../generators/plugPowerGenerator');
const windowState = require('../generators/windowStateGenerator');
const pressureDifferential = require('../generators/pressureDifferentialGenerator');
const meetingRoomNoise = require('../generators/meetingRoomNoiseGenerator');

const GENERATORS = [
  ['deskOccupancyGenerator', deskOccupancy],
  ['roomCo2Generator', roomCo2],
  ['roomTemperatureGenerator', roomTemperature],
  ['roomHumidityGenerator', roomHumidity],
  ['lightLevelGenerator', lightLevel],
  ['peopleCounterGenerator', peopleCounter],
  ['plugPowerGenerator', plugPower],
  ['windowStateGenerator', windowState],
  ['pressureDifferentialGenerator', pressureDifferential],
  ['meetingRoomNoiseGenerator', meetingRoomNoise],
];

const ITERATIONS = 5000;

describe.each(GENERATORS)('%s', (name, generator) => {
  test('nextValue stays within [MIN, MAX] across many iterations from undefined seed', () => {
    let value;
    for (let i = 0; i < ITERATIONS; i += 1) {
      value = generator.nextValue(value);
      expect(value).toBeGreaterThanOrEqual(generator.MIN);
      expect(value).toBeLessThanOrEqual(generator.MAX);
      expect(Number.isNaN(value)).toBe(false);
    }
  });

  test('nextValue stays within bounds when seeded at the MIN boundary', () => {
    let value = generator.MIN;
    for (let i = 0; i < ITERATIONS; i += 1) {
      value = generator.nextValue(value);
      expect(value).toBeGreaterThanOrEqual(generator.MIN);
      expect(value).toBeLessThanOrEqual(generator.MAX);
    }
  });

  test('nextValue stays within bounds when seeded at the MAX boundary', () => {
    let value = generator.MAX;
    for (let i = 0; i < ITERATIONS; i += 1) {
      value = generator.nextValue(value);
      expect(value).toBeGreaterThanOrEqual(generator.MIN);
      expect(value).toBeLessThanOrEqual(generator.MAX);
    }
  });
});
