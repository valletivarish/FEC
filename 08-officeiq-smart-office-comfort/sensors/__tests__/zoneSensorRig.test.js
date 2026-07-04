'use strict';

const fs = require('fs');
const path = require('path');
const { ZoneSensorRig } = require('../zoneSensorRig');
const { loadZoneConfig, ZONE_IDS } = require('../index');

describe('zone-101.sensors.json config loader', () => {
  const zoneConfig = loadZoneConfig('zone-101');

  test('defines all 10 sensor metrics from the contract', () => {
    const expectedMetrics = [
      'desk-occupancy',
      'room-co2',
      'room-temperature',
      'room-humidity',
      'light-level',
      'people-counter',
      'plug-power',
      'window-state',
      'pressure-differential',
      'meeting-room-noise',
    ];
    expect(Object.keys(zoneConfig.sensors).sort()).toEqual(expectedMetrics.sort());
  });

  test('applies independent sampleFrequencyMs and dispatchRateMs per sensor', () => {
    expect(zoneConfig.sensors['desk-occupancy'].sampleFrequencyMs).toBe(5000);
    expect(zoneConfig.sensors['people-counter'].sampleFrequencyMs).toBe(5000);
    expect(zoneConfig.sensors['room-co2'].sampleFrequencyMs).toBe(10000);
    expect(zoneConfig.sensors['room-temperature'].sampleFrequencyMs).toBe(10000);
    expect(zoneConfig.sensors['room-humidity'].sampleFrequencyMs).toBe(10000);
    expect(zoneConfig.sensors['plug-power'].sampleFrequencyMs).toBe(15000);
    expect(zoneConfig.sensors['light-level'].sampleFrequencyMs).toBe(15000);
    expect(zoneConfig.sensors['window-state'].sampleFrequencyMs).toBe(20000);
    expect(zoneConfig.sensors['pressure-differential'].sampleFrequencyMs).toBe(20000);
    expect(zoneConfig.sensors['meeting-room-noise'].sampleFrequencyMs).toBe(20000);

    // rates differ across metrics, confirming they are not a single shared global interval
    const distinctFrequencies = new Set(
      Object.values(zoneConfig.sensors).map((s) => s.sampleFrequencyMs)
    );
    expect(distinctFrequencies.size).toBeGreaterThan(1);
  });

  test('all 4 zone config files exist and load with matching zoneId', () => {
    for (const zoneId of ZONE_IDS) {
      const configPath = path.join(__dirname, '..', 'config', `${zoneId}.sensors.json`);
      expect(fs.existsSync(configPath)).toBe(true);
      const config = loadZoneConfig(zoneId);
      expect(config.zoneId).toBe(zoneId);
    }
  });
});

describe('ZoneSensorRig', () => {
  beforeEach(() => {
    jest.useFakeTimers();
  });

  afterEach(() => {
    jest.clearAllTimers();
    jest.useRealTimers();
  });

  test('samples at each metric own sampleFrequencyMs independently', () => {
    const zoneConfig = {
      zoneId: 'zone-101',
      sensors: {
        'desk-occupancy': { sampleFrequencyMs: 1000, dispatchRateMs: 100000, unit: 'desks' },
        'room-co2': { sampleFrequencyMs: 3000, dispatchRateMs: 100000, unit: 'ppm' },
      },
    };
    const rig = new ZoneSensorRig(zoneConfig, {}, { publishFn: jest.fn() });
    rig.start();

    jest.advanceTimersByTime(1000);
    expect(rig.latestValues['desk-occupancy']).toBeDefined();
    expect(rig.latestValues['room-co2']).toBeUndefined();

    jest.advanceTimersByTime(2000);
    expect(rig.latestValues['room-co2']).toBeDefined();

    rig.stop();
  });

  test('dispatches at each metric own dispatchRateMs independently, using the latest sampled value', () => {
    const publishFn = jest.fn();
    const zoneConfig = {
      zoneId: 'zone-101',
      sensors: {
        'desk-occupancy': { sampleFrequencyMs: 500, dispatchRateMs: 2000, unit: 'desks' },
        'room-co2': { sampleFrequencyMs: 500, dispatchRateMs: 5000, unit: 'ppm' },
      },
    };
    const rig = new ZoneSensorRig(zoneConfig, { id: 'fake-client' }, { publishFn });
    rig.start();

    jest.advanceTimersByTime(2000);
    const deskDispatches = publishFn.mock.calls.filter(([, reading]) => reading.metric === 'desk-occupancy');
    const co2Dispatches = publishFn.mock.calls.filter(([, reading]) => reading.metric === 'room-co2');
    expect(deskDispatches.length).toBe(1);
    expect(co2Dispatches.length).toBe(0);

    jest.advanceTimersByTime(3000);
    const co2DispatchesAfter = publishFn.mock.calls.filter(([, reading]) => reading.metric === 'room-co2');
    expect(co2DispatchesAfter.length).toBe(1);

    rig.stop();
  });

  test('published reading matches the officeiq/{zoneId}/{metric} contract shape', () => {
    const publishFn = jest.fn();
    const zoneConfig = {
      zoneId: 'zone-201',
      sensors: {
        'room-temperature': { sampleFrequencyMs: 1000, dispatchRateMs: 1000, unit: 'degC' },
      },
    };
    const rig = new ZoneSensorRig(zoneConfig, {}, { publishFn });
    rig.start();

    jest.advanceTimersByTime(1000);

    expect(publishFn).toHaveBeenCalledTimes(1);
    const [, reading] = publishFn.mock.calls[0];
    expect(reading.zoneId).toBe('zone-201');
    expect(reading.metric).toBe('room-temperature');
    expect(reading.unit).toBe('degC');
    expect(typeof reading.value).toBe('number');
    expect(() => new Date(reading.timestamp).toISOString()).not.toThrow();

    rig.stop();
  });

  test('stop() clears all timers so no further sampling or dispatch occurs', () => {
    const publishFn = jest.fn();
    const zoneConfig = {
      zoneId: 'zone-101',
      sensors: {
        'desk-occupancy': { sampleFrequencyMs: 500, dispatchRateMs: 500, unit: 'desks' },
      },
    };
    const rig = new ZoneSensorRig(zoneConfig, {}, { publishFn });
    rig.start();
    jest.advanceTimersByTime(500);
    rig.stop();
    const callsBefore = publishFn.mock.calls.length;

    jest.advanceTimersByTime(5000);
    expect(publishFn.mock.calls.length).toBe(callsBefore);
  });
});
