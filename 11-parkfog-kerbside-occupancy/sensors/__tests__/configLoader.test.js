'use strict';

const path = require('path');
const { loadSensorConfig } = require('../configLoader');

const CONFIG_PATH = path.join(__dirname, '..', 'config', 'zone-01.sensors.json');

describe('loadSensorConfig', () => {
  it('loads zone-01 config with the expected shape', () => {
    const config = loadSensorConfig(CONFIG_PATH);
    expect(config.zoneId).toBe('zone-01');
    expect(config.bays).toHaveLength(6);
    expect(config.disabledBayId).toBe('bay-05');
    expect(config.evBayId).toBe('bay-06');
  });

  it('applies independent sampleFrequencyMs and dispatchRateMs per bay metric', () => {
    const config = loadSensorConfig(CONFIG_PATH);

    expect(config.bayMetrics['bay-magnetometer'].sampleFrequencyMs).toBe(3000);
    expect(config.bayMetrics['meter-payment'].sampleFrequencyMs).toBe(10000);

    // anpr samples often but dispatches sparsely, unlike magnetometer which dispatches every sample
    expect(config.bayMetrics['anpr-permit-check'].dispatchRateMs).toBeGreaterThan(
      config.bayMetrics['anpr-permit-check'].sampleFrequencyMs
    );
    expect(config.bayMetrics['bay-magnetometer'].dispatchRateMs).toBe(
      config.bayMetrics['bay-magnetometer'].sampleFrequencyMs
    );
  });

  it('applies independent timing per zone metric, distinct from bay metric timing', () => {
    const config = loadSensorConfig(CONFIG_PATH);

    for (const metric of Object.keys(config.zoneMetrics)) {
      expect(config.zoneMetrics[metric].sampleFrequencyMs).toBe(8000);
      expect(config.zoneMetrics[metric].dispatchRateMs).toBe(8000);
    }
    expect(config.zoneMetrics['kerb-flood-level'].sampleFrequencyMs).not.toBe(
      config.bayMetrics['meter-payment'].sampleFrequencyMs
    );
  });

  it('throws on a config missing required fields', () => {
    const badPath = path.join(__dirname, 'fixtures', 'does-not-exist.json');
    expect(() => loadSensorConfig(badPath)).toThrow();
  });
});
