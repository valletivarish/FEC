const { AccessPaymentFog } = require('../access-payment/accessPaymentFog');

function meterReading(bayId, value, timestamp) {
  return { scope: 'bay', id: bayId, metric: 'meter-payment', value, unit: 'minutes', timestamp };
}

function anprReading(bayId, value, timestamp) {
  return { scope: 'bay', id: bayId, metric: 'anpr-permit-check', value, unit: 'percent', timestamp };
}

function barrierReading(zoneId, value, timestamp) {
  return { scope: 'zone', id: zoneId, metric: 'barrier-entry-count', value, unit: 'count', timestamp };
}

function approachReading(zoneId, value, timestamp) {
  return { scope: 'zone', id: zoneId, metric: 'approach-inbound-count', value, unit: 'count', timestamp };
}

describe('AccessPaymentFog overstay detection', () => {
  test('dispatches overstay_event when minutes remaining <= 0 and ANPR confidence is below 85', () => {
    const fog = new AccessPaymentFog();
    fog.onReading(anprReading('bay-01', 50, 't0'));
    const events = fog.onReading(meterReading('bay-01', 0, 't1'));

    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      type: 'overstay_event',
      bayId: 'bay-01',
      purchasedMinutesRemaining: 0,
      anprConfidence: 50,
    });
  });

  test('negative minutes remaining also counts as overstay', () => {
    const fog = new AccessPaymentFog();
    fog.onReading(anprReading('bay-01', 40, 't0'));
    const events = fog.onReading(meterReading('bay-01', -5, 't1'));
    expect(events).toHaveLength(1);
  });

  test('suppresses overstay_event when ANPR confidence is >= 85 (permit-exempt)', () => {
    const fog = new AccessPaymentFog();
    fog.onReading(anprReading('bay-02', 90, 't0'));
    const events = fog.onReading(meterReading('bay-02', 0, 't1'));
    expect(events).toHaveLength(0);
  });

  test('boundary: ANPR confidence of exactly 85 is exempt', () => {
    const fog = new AccessPaymentFog();
    fog.onReading(anprReading('bay-02', 85, 't0'));
    const events = fog.onReading(meterReading('bay-02', 0, 't1'));
    expect(events).toHaveLength(0);
  });

  test('positive minutes remaining does not trigger overstay', () => {
    const fog = new AccessPaymentFog();
    fog.onReading(anprReading('bay-03', 50, 't0'));
    const events = fog.onReading(meterReading('bay-03', 30, 't1'));
    expect(events).toHaveLength(0);
  });

  test('debounces overstay dispatch to at most once per bay per 10 ticks', () => {
    const fog = new AccessPaymentFog();
    fog.onReading(anprReading('bay-04', 40, 't0'));
    const first = fog.onReading(meterReading('bay-04', 0, 't1'));
    expect(first).toHaveLength(1);

    // the next 9 overstay ticks immediately after must be suppressed by the debounce
    for (let i = 0; i < 9; i += 1) {
      const events = fog.onReading(meterReading('bay-04', 0, `t-${i}`));
      expect(events).toHaveLength(0);
    }

    // the 10th subsequent meter-payment tick clears the debounce window and dispatches again
    const tenth = fog.onReading(meterReading('bay-04', 0, 't-final'));
    expect(tenth).toHaveLength(1);
  });

  test('tracks bays independently for debounce and exemption state', () => {
    const fog = new AccessPaymentFog();
    fog.onReading(anprReading('bay-05', 30, 't0'));
    fog.onReading(anprReading('bay-06', 95, 't0'));

    const bay05Events = fog.onReading(meterReading('bay-05', 0, 't1'));
    const bay06Events = fog.onReading(meterReading('bay-06', 0, 't1'));

    expect(bay05Events).toHaveLength(1);
    expect(bay06Events).toHaveLength(0);
  });
});

describe('AccessPaymentFog zone entry pressure EWMA heartbeat', () => {
  test('dispatches zone_pressure_event only every 5th combined zone reading', () => {
    const fog = new AccessPaymentFog();
    const dispatchedTicks = [];

    for (let i = 1; i <= 10; i += 1) {
      const reading = i % 2 === 0 ? approachReading('zone-01', 5, `t${i}`) : barrierReading('zone-01', 3, `t${i}`);
      const events = fog.onReading(reading);
      if (events.length > 0) dispatchedTicks.push(i);
    }

    expect(dispatchedTicks).toEqual([5, 10]);
  });

  test('barrier-entry-count and approach-inbound-count both feed the same shared EWMA', () => {
    const fog = new AccessPaymentFog();
    fog.onReading(barrierReading('zone-01', 10, 't1'));
    fog.onReading(approachReading('zone-01', 10, 't2'));
    fog.onReading(barrierReading('zone-01', 10, 't3'));
    fog.onReading(approachReading('zone-01', 10, 't4'));
    const events = fog.onReading(barrierReading('zone-01', 10, 't5'));

    expect(events).toHaveLength(1);
    // all samples are 10, so the EWMA converges to 10 regardless of alpha
    expect(events[0].entryPressureEwma).toBeCloseTo(10, 5);
  });

  test('EWMA applies alpha=0.3 weighting to the first update after the seed sample', () => {
    const fog = new AccessPaymentFog();
    fog.onReading(barrierReading('zone-01', 10, 't1')); // seeds ewma = 10
    fog.onReading(approachReading('zone-01', 0, 't2')); // ewma = 0.3*0 + 0.7*10 = 7
    fog.onReading(barrierReading('zone-01', 0, 't3')); // ewma = 0.3*0 + 0.7*7 = 4.9
    fog.onReading(approachReading('zone-01', 0, 't4')); // ewma = 0.3*0 + 0.7*4.9 = 3.43
    const events = fog.onReading(barrierReading('zone-01', 0, 't5')); // ewma = 0.7*3.43 = 2.401

    expect(events[0].entryPressureEwma).toBeCloseTo(2.401, 5);
  });

  test('never returns both overstay_event and zone_pressure_event from the same onReading call', () => {
    const fog = new AccessPaymentFog();
    fog.onReading(anprReading('bay-01', 20, 't0'));
    const bayEvents = fog.onReading(meterReading('bay-01', 0, 't1'));
    expect(bayEvents.every((e) => e.type === 'overstay_event')).toBe(true);

    for (let i = 1; i <= 5; i += 1) {
      const zoneEvents = fog.onReading(barrierReading('zone-01', 5, `z${i}`));
      expect(zoneEvents.every((e) => e.type === 'zone_pressure_event')).toBe(true);
    }
  });
});
