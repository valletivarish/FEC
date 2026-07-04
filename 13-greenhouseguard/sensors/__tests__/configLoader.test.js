const { loadZoneConfig } = require('../configLoader');

const ZONE_IDS = ['zone-a', 'zone-b', 'zone-c'];
const EXPECTED_METRICS = [
  'air-temperature',
  'air-humidity',
  'co2',
  'par-light',
  'substrate-moisture',
  'substrate-ec',
  'water-ph',
  'water-temperature',
  'vent-position',
  'door-contact'
];

describe('loadZoneConfig', () => {
  test.each(ZONE_IDS)('%s config defines every one of the 10 sensor metrics', (zoneId) => {
    const config = loadZoneConfig(zoneId);
    EXPECTED_METRICS.forEach((metric) => {
      expect(config).toHaveProperty(metric);
      expect(typeof config[metric].sampleFrequencyMs).toBe('number');
      expect(typeof config[metric].dispatchRateMs).toBe('number');
      expect(config[metric].sampleFrequencyMs).toBeGreaterThan(0);
      expect(config[metric].dispatchRateMs).toBeGreaterThan(0);
    });
  });

  test('each zone has an independent config object (not a shared reference)', () => {
    const zoneA = loadZoneConfig('zone-a');
    const zoneB = loadZoneConfig('zone-b');
    zoneA['air-temperature'].sampleFrequencyMs = 999999;
    expect(zoneB['air-temperature'].sampleFrequencyMs).not.toBe(999999);
  });

  test('sampleFrequencyMs and dispatchRateMs are independently configurable per sensor', () => {
    const config = loadZoneConfig('zone-a');
    const rates = new Set(
      EXPECTED_METRICS.map((metric) => `${config[metric].sampleFrequencyMs}:${config[metric].dispatchRateMs}`)
    );
    expect(rates.size).toBeGreaterThan(1);
  });

  test('throws for an unknown zone id', () => {
    expect(() => loadZoneConfig('zone-does-not-exist')).toThrow();
  });
});
