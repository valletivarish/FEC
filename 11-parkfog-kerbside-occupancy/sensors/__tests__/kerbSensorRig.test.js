'use strict';

const { KerbSensorRig } = require('../kerbSensorRig');

function buildConfig() {
  return {
    zoneId: 'zone-01',
    bays: ['bay-01'],
    disabledBayId: 'bay-05',
    evBayId: 'bay-06',
    bayMetrics: {
      'bay-magnetometer': { sampleFrequencyMs: 1000, dispatchRateMs: 2000 },
      'bay-infrared': { sampleFrequencyMs: 1000, dispatchRateMs: 2000 },
      'anpr-permit-check': { sampleFrequencyMs: 1000, dispatchRateMs: 1000 },
      'meter-payment': { sampleFrequencyMs: 1000, dispatchRateMs: 3000 },
      'ev-charge-state': { sampleFrequencyMs: 1000, dispatchRateMs: 1000 },
      'disabled-bay-badge-scan': { sampleFrequencyMs: 1000, dispatchRateMs: 1000 }
    },
    zoneMetrics: {
      'barrier-entry-count': { sampleFrequencyMs: 1000, dispatchRateMs: 4000 },
      'kerb-flood-level': { sampleFrequencyMs: 1000, dispatchRateMs: 4000 },
      'approach-inbound-count': { sampleFrequencyMs: 1000, dispatchRateMs: 4000 },
      'camera-free-space-count': { sampleFrequencyMs: 1000, dispatchRateMs: 4000 }
    }
  };
}

describe('KerbSensorRig', () => {
  beforeEach(() => {
    jest.useFakeTimers();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('publishes bay-magnetometer readings on its own dispatchRateMs, independent of sampleFrequencyMs', () => {
    const publish = jest.fn();
    const config = buildConfig();
    const rig = new KerbSensorRig(config, { publish });
    rig.start();

    jest.advanceTimersByTime(2000);

    const magnetometerTopics = publish.mock.calls
      .map(([topic]) => topic)
      .filter((topic) => topic === 'parkfog/bay/bay-01/bay-magnetometer');

    // dispatchRateMs is 2000, sampleFrequencyMs is 1000, so exactly one publish by t=2000
    expect(magnetometerTopics.length).toBe(1);

    rig.stop();
  });

  it('applies a longer dispatch cadence to meter-payment than to ev-charge-state', () => {
    const publish = jest.fn();
    const config = buildConfig();
    const rig = new KerbSensorRig(config, { publish });
    rig.start();

    jest.advanceTimersByTime(3000);

    const meterPaymentCalls = publish.mock.calls.filter(
      ([topic]) => topic === 'parkfog/bay/bay-01/meter-payment'
    ).length;
    const evChargeStateCalls = publish.mock.calls.filter(
      ([topic]) => topic === 'parkfog/bay/bay-01/ev-charge-state'
    ).length;

    expect(meterPaymentCalls).toBe(1);
    expect(evChargeStateCalls).toBe(3);

    rig.stop();
  });

  it('stops all timers on stop() so no further publishes occur', () => {
    const publish = jest.fn();
    const config = buildConfig();
    const rig = new KerbSensorRig(config, { publish });
    rig.start();

    jest.advanceTimersByTime(1000);
    rig.stop();
    const callsBeforeStop = publish.mock.calls.length;

    jest.advanceTimersByTime(5000);
    expect(publish.mock.calls.length).toBe(callsBeforeStop);
  });
});
