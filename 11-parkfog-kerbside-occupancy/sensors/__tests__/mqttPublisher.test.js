'use strict';

const { publishReading } = require('../mqttPublisher');

describe('publishReading', () => {
  it('publishes per-bay readings to parkfog/bay/{bayId}/{metric}', () => {
    const publish = jest.fn();
    const reading = {
      scope: 'bay',
      id: 'bay-05',
      metric: 'bay-magnetometer',
      value: 12.3,
      unit: 'uT',
      timestamp: '2026-07-02T00:00:00.000Z'
    };

    const topic = publishReading({ publish }, reading);

    expect(topic).toBe('parkfog/bay/bay-05/bay-magnetometer');
    expect(publish).toHaveBeenCalledWith('parkfog/bay/bay-05/bay-magnetometer', JSON.stringify(reading));
  });

  it('publishes per-zone readings to parkfog/zone/{zoneId}/{metric}', () => {
    const publish = jest.fn();
    const reading = {
      scope: 'zone',
      id: 'zone-01',
      metric: 'kerb-flood-level',
      value: 42,
      unit: 'mm',
      timestamp: '2026-07-02T00:00:00.000Z'
    };

    const topic = publishReading({ publish }, reading);

    expect(topic).toBe('parkfog/zone/zone-01/kerb-flood-level');
    expect(publish).toHaveBeenCalledWith('parkfog/zone/zone-01/kerb-flood-level', JSON.stringify(reading));
  });
});
