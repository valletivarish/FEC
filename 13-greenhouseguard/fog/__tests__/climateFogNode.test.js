const { ClimateFogNode } = require('../climate-fog/climateFogNode');

function humidityReading(zoneId, value, timestamp) {
  return { zoneId, metric: 'air-humidity', value, unit: '%RH', timestamp };
}
function tempReading(zoneId, value, timestamp) {
  return { zoneId, metric: 'air-temperature', value, unit: 'degC', timestamp };
}
function parReading(zoneId, value, timestamp) {
  return { zoneId, metric: 'par-light', value, unit: 'umol/m2/s', timestamp };
}
function co2Reading(zoneId, value, timestamp) {
  return { zoneId, metric: 'co2', value, unit: 'ppm', timestamp };
}

describe('ClimateFogNode VPD calculation', () => {
  test('computes VPD via Tetens equation against a hand-computed reference', () => {
    const node = new ClimateFogNode();
    node.onReading(tempReading('zone-a', 24, '2026-06-01T10:00:00.000Z'));
    const events = node.onReading(humidityReading('zone-a', 65, '2026-06-01T10:00:00.000Z'));

    expect(events).toHaveLength(1);
    expect(events[0].vpdKpa).toBeCloseTo(1.0443369201802768, 6);
    expect(events[0].ventPositionSetpoint).toBe(46);
  });

  test('does not emit until both temperature and humidity are known for the zone', () => {
    const node = new ClimateFogNode();
    const events = node.onReading(humidityReading('zone-a', 65, '2026-06-01T10:00:00.000Z'));
    expect(events).toEqual([]);
  });
});

describe('ClimateFogNode setpoint_command dispatch rule', () => {
  test('dispatches when setpoint delta exceeds 5 percentage points from last published', () => {
    const node = new ClimateFogNode();
    node.onReading(tempReading('zone-a', 24, '2026-06-01T10:00:00.000Z'));
    const first = node.onReading(humidityReading('zone-a', 65, '2026-06-01T10:00:00.000Z'));
    expect(first).toHaveLength(1);
    expect(first[0].ventPositionSetpoint).toBe(46);

    // Push humidity much lower -> big VPD increase -> setpoint should drop well past 5pp delta
    node.onReading(tempReading('zone-a', 24, '2026-06-01T10:05:00.000Z'));
    const second = node.onReading(humidityReading('zone-a', 30, '2026-06-01T10:05:00.000Z'));
    expect(second).toHaveLength(1);
    expect(Math.abs(second[0].ventPositionSetpoint - 46)).toBeGreaterThan(5);
  });

  test('suppresses dispatch when delta is within 5pp and not a heartbeat reading', () => {
    const node = new ClimateFogNode();
    node.onReading(tempReading('zone-a', 24, '2026-06-01T10:00:00.000Z'));
    const first = node.onReading(humidityReading('zone-a', 65, '2026-06-01T10:00:00.000Z'));
    expect(first).toHaveLength(1);

    // Tiny humidity nudge -> setpoint should barely move, well under 5pp
    node.onReading(tempReading('zone-a', 24, '2026-06-01T10:05:00.000Z'));
    const second = node.onReading(humidityReading('zone-a', 65.1, '2026-06-01T10:05:00.000Z'));
    expect(second).toEqual([]);
  });

  test('dispatches every 10th humidity reading as a heartbeat even with no meaningful delta', () => {
    const node = new ClimateFogNode();
    let lastEvents = [];
    for (let i = 1; i <= 10; i++) {
      node.onReading(tempReading('zone-a', 24, `2026-06-01T10:${String(i).padStart(2, '0')}:00.000Z`));
      lastEvents = node.onReading(humidityReading('zone-a', 65, `2026-06-01T10:${String(i).padStart(2, '0')}:00.000Z`));
    }
    // reading #1 dispatches (first ever), readings 2-9 should be suppressed (no delta), #10 is heartbeat
    expect(lastEvents).toHaveLength(1);
  });
});

describe('ClimateFogNode Daily Light Integral', () => {
  test('true trapezoidal integration matches hand-computed integral on a 3-point fixture', () => {
    const node = new ClimateFogNode();
    node.onReading(parReading('zone-a', 0, '2026-06-01T06:00:00.000Z'));
    node.onReading(parReading('zone-a', 200, '2026-06-01T06:10:00.000Z'));
    node.onReading(parReading('zone-a', 400, '2026-06-01T06:20:00.000Z'));

    expect(node.dliTotalByZone.get('zone-a')).toBeCloseTo(0.24, 9);
  });

  test('resets accumulator to 0 when the UTC calendar date rolls over', () => {
    const node = new ClimateFogNode();
    node.onReading(parReading('zone-a', 500, '2026-06-01T12:00:00.000Z'));
    node.onReading(parReading('zone-a', 500, '2026-06-01T12:10:00.000Z'));
    expect(node.dliTotalByZone.get('zone-a')).toBeGreaterThan(0);

    node.onReading(parReading('zone-a', 100, '2026-06-02T06:00:00.000Z'));
    expect(node.dliTotalByZone.get('zone-a')).toBe(0);
  });

  test('dispatches exactly one dli_event per day when shortfall persists past hour 18', () => {
    const node = new ClimateFogNode();
    // Keep total well below 17 mol/m2/day target
    node.onReading(parReading('zone-a', 50, '2026-06-01T06:00:00.000Z'));
    node.onReading(parReading('zone-a', 50, '2026-06-01T12:00:00.000Z'));

    const firstFlag = node.onReading(parReading('zone-a', 50, '2026-06-01T18:00:00.000Z'));
    expect(firstFlag).toHaveLength(1);
    expect(firstFlag[0].type).toBe('dli_event');
    expect(firstFlag[0].shortfall).toBe(true);

    const secondReadingSameDay = node.onReading(parReading('zone-a', 50, '2026-06-01T19:00:00.000Z'));
    expect(secondReadingSameDay).toEqual([]);
  });

  test('flag resets on date rollover so a new shortfall day can flag again', () => {
    const node = new ClimateFogNode();
    node.onReading(parReading('zone-a', 50, '2026-06-01T06:00:00.000Z'));
    const firstFlag = node.onReading(parReading('zone-a', 50, '2026-06-01T18:00:00.000Z'));
    expect(firstFlag).toHaveLength(1);

    node.onReading(parReading('zone-a', 50, '2026-06-02T06:00:00.000Z'));
    const secondFlag = node.onReading(parReading('zone-a', 50, '2026-06-02T18:00:00.000Z'));
    expect(secondFlag).toHaveLength(1);
  });
});

describe('ClimateFogNode CO2 enrichment-band classification', () => {
  test('dispatches an OK co2_event for the first-ever in-band reading (matches the fertigation nodes\' own first-reading precedent)', () => {
    const node = new ClimateFogNode();
    const events = node.onReading(co2Reading('zone-a', 900, '2026-06-01T10:00:00.000Z'));
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ type: 'co2_event', zoneId: 'zone-a', co2Ppm: 900, severity: 'OK' });
  });

  test('suppresses a second in-band reading since severity has not changed', () => {
    const node = new ClimateFogNode();
    node.onReading(co2Reading('zone-a', 900, '2026-06-01T10:00:00.000Z'));
    const events = node.onReading(co2Reading('zone-a', 950, '2026-06-01T10:05:00.000Z'));
    expect(events).toEqual([]);
  });

  test('dispatches a WARNING co2_event on a transition below the band', () => {
    const node = new ClimateFogNode();
    node.onReading(co2Reading('zone-a', 900, '2026-06-01T10:00:00.000Z'));
    const events = node.onReading(co2Reading('zone-a', 500, '2026-06-01T10:05:00.000Z'));

    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ type: 'co2_event', zoneId: 'zone-a', co2Ppm: 500, severity: 'WARNING' });
  });

  test('dispatches a WARNING co2_event on a transition above the band', () => {
    const node = new ClimateFogNode();
    node.onReading(co2Reading('zone-a', 900, '2026-06-01T10:00:00.000Z'));
    const events = node.onReading(co2Reading('zone-a', 1800, '2026-06-01T10:05:00.000Z'));

    expect(events).toHaveLength(1);
    expect(events[0].severity).toBe('WARNING');
  });

  test('suppresses repeat dispatch while severity stays unchanged', () => {
    const node = new ClimateFogNode();
    node.onReading(co2Reading('zone-a', 1800, '2026-06-01T10:00:00.000Z'));
    const events = node.onReading(co2Reading('zone-a', 1900, '2026-06-01T10:05:00.000Z'));
    expect(events).toEqual([]);
  });

  test('dispatches an OK co2_event when the reading returns to the band', () => {
    const node = new ClimateFogNode();
    node.onReading(co2Reading('zone-a', 1800, '2026-06-01T10:00:00.000Z'));
    const events = node.onReading(co2Reading('zone-a', 1000, '2026-06-01T10:05:00.000Z'));

    expect(events).toHaveLength(1);
    expect(events[0].severity).toBe('OK');
  });
});
