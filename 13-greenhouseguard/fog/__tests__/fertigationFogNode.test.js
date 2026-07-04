const { FertigationFogNode } = require('../fertigation-fog/fertigationFogNode');

function ecReading(zoneId, value, timestamp) {
  return { zoneId, metric: 'substrate-ec', value, unit: 'mS/cm', timestamp };
}
function phReading(zoneId, value, timestamp) {
  return { zoneId, metric: 'water-ph', value, unit: 'pH', timestamp };
}
function moistureReading(zoneId, value, timestamp) {
  return { zoneId, metric: 'substrate-moisture', value, unit: '%VWC', timestamp };
}
function waterTempReading(zoneId, value, timestamp) {
  return { zoneId, metric: 'water-temperature', value, unit: 'degC', timestamp };
}

function feedReadings(node, readingFn, zoneId, values, startMinute = 0) {
  let lastEvents = [];
  values.forEach((value, i) => {
    const minute = startMinute + i;
    const timestamp = `2026-06-01T10:${String(minute).padStart(2, '0')}:00.000Z`;
    lastEvents = node.onReading(readingFn(zoneId, value, timestamp));
  });
  return lastEvents;
}

describe('FertigationFogNode OLS slope', () => {
  test('matches a hand-computed reference slope on a monotonic fixture', () => {
    const node = new FertigationFogNode();
    // monotonic increasing EC values, step 0.1, entirely within safe range -> slope should be ~0.1
    feedReadings(node, ecReading, 'zone-a', [1.5, 1.6, 1.7, 1.8, 1.9, 2.0]);
    const events = feedReadings(node, ecReading, 'zone-a', [2.1]);
    expect(events).toHaveLength(0); // still OK severity, slope 0.1 < 0.3 warning threshold, no transition to dispatch
  });

  test('computed slope value is accurate on a 6-sample window', () => {
    const node = new FertigationFogNode();
    const values = [1.5, 1.6, 1.7, 1.8, 1.9, 2.0];
    values.forEach((value, i) => {
      node.onReading(ecReading('zone-a', value, `2026-06-01T10:0${i}:00.000Z`));
    });
    expect(node.ecWindowByZone.get('zone-a')).toEqual(values);
  });
});

describe('FertigationFogNode severity classification', () => {
  test('CRITICAL absolute-range breach takes priority over WARNING slope on the same reading', () => {
    const node = new FertigationFogNode();
    // build a steep warming EC window (slope > 0.3) then push a value that is ALSO a critical breach
    const events = feedReadings(node, ecReading, 'zone-a', [1.5, 1.9, 2.3, 2.7, 3.1, 3.6]);
    expect(events).toHaveLength(1);
    expect(events[0].severity).toBe('CRITICAL');
  });

  test('dispatches WARNING when slope exceeds threshold while value stays in range', () => {
    const node = new FertigationFogNode();
    const events = feedReadings(node, ecReading, 'zone-a', [1.5, 1.9, 2.3, 2.7, 3.1, 3.4]);
    expect(events).toHaveLength(1);
    expect(events[0].severity).toBe('WARNING');
  });

  test('dispatches only on severity change, not on repeated CRITICAL readings', () => {
    const node = new FertigationFogNode();
    const first = feedReadings(node, ecReading, 'zone-a', [1.5, 1.6, 1.7, 1.8, 1.9, 4.0]);
    expect(first).toHaveLength(1);
    expect(first[0].severity).toBe('CRITICAL');

    // two more consecutive CRITICAL readings should NOT re-dispatch
    const second = node.onReading(ecReading('zone-a', 4.1, '2026-06-01T10:06:00.000Z'));
    const third = node.onReading(ecReading('zone-a', 4.2, '2026-06-01T10:07:00.000Z'));
    expect(second).toEqual([]);
    expect(third).toEqual([]);
  });

  test('dispatches an OK recovery transition after a CRITICAL breach clears', () => {
    const node = new FertigationFogNode();
    feedReadings(node, phReading, 'zone-a', [5.8, 5.9, 6.0, 6.1, 6.2, 5.4]);
    const events = node.onReading(phReading('zone-a', 6.0, '2026-06-01T10:06:00.000Z'));
    expect(events).toHaveLength(1);
    expect(events[0].severity).toBe('OK');
    expect(events[0].doseDirection).toBeNull();
  });
});

describe('FertigationFogNode doseDirection sign mapping', () => {
  test('EC: negative slope on breach maps to increase_ec_dose', () => {
    const node = new FertigationFogNode();
    const events = feedReadings(node, ecReading, 'zone-a', [2.0, 1.8, 1.6, 1.4, 1.2, 1.1, 0.9]);
    expect(events).toHaveLength(1);
    expect(events[0].severity).toBe('CRITICAL');
    expect(events[0].slopePerReading).toBeLessThan(0);
    expect(events[0].doseDirection).toBe('increase_ec_dose');
  });

  test('EC: positive slope on breach maps to decrease_ec_dose', () => {
    const node = new FertigationFogNode();
    const events = feedReadings(node, ecReading, 'zone-a', [2.0, 2.2, 2.4, 2.6, 2.8, 3.0, 3.6]);
    expect(events).toHaveLength(1);
    expect(events[0].severity).toBe('CRITICAL');
    expect(events[0].slopePerReading).toBeGreaterThan(0);
    expect(events[0].doseDirection).toBe('decrease_ec_dose');
  });

  test('pH: negative slope on breach maps to increase_ph_buffer', () => {
    const node = new FertigationFogNode();
    const events = feedReadings(node, phReading, 'zone-a', [6.3, 6.2, 6.1, 6.0, 5.9, 5.8, 5.4]);
    expect(events).toHaveLength(1);
    expect(events[0].severity).toBe('CRITICAL');
    expect(events[0].slopePerReading).toBeLessThan(0);
    expect(events[0].doseDirection).toBe('increase_ph_buffer');
  });

  test('pH: positive slope on breach maps to decrease_ph_buffer', () => {
    const node = new FertigationFogNode();
    const events = feedReadings(node, phReading, 'zone-a', [5.8, 5.9, 6.0, 6.1, 6.2, 6.3, 6.6]);
    expect(events).toHaveLength(1);
    expect(events[0].severity).toBe('CRITICAL');
    expect(events[0].slopePerReading).toBeGreaterThan(0);
    expect(events[0].doseDirection).toBe('decrease_ph_buffer');
  });

  test('omits doseDirection when window lacks enough samples for a CRITICAL breach', () => {
    const node = new FertigationFogNode();
    const events = node.onReading(ecReading('zone-a', 4.0, '2026-06-01T10:00:00.000Z'));
    expect(events).toHaveLength(1);
    expect(events[0].severity).toBe('CRITICAL');
    expect(events[0].doseDirection).toBeNull();
    expect(events[0].slopePerReading).toBeNull();
  });
});

describe('FertigationFogNode low moisture flag', () => {
  test('attaches lowMoisture true when latest substrate-moisture is below 15', () => {
    const node = new FertigationFogNode();
    node.onReading(moistureReading('zone-a', 10, '2026-06-01T09:59:00.000Z'));
    const events = node.onReading(ecReading('zone-a', 4.0, '2026-06-01T10:00:00.000Z'));
    expect(events[0].lowMoisture).toBe(true);
  });

  test('omits/false lowMoisture when moisture is at or above 15', () => {
    const node = new FertigationFogNode();
    node.onReading(moistureReading('zone-a', 20, '2026-06-01T09:59:00.000Z'));
    const events = node.onReading(ecReading('zone-a', 4.0, '2026-06-01T10:00:00.000Z'));
    expect(events[0].lowMoisture).toBe(false);
  });
});

describe('FertigationFogNode water-temperature handling', () => {
  test('dispatches WARNING when water temperature drops below the 15-28 degC band', () => {
    const node = new FertigationFogNode();
    const events = node.onReading(waterTempReading('zone-a', 12, '2026-06-01T10:00:00.000Z'));
    expect(events).toHaveLength(1);
    expect(events[0].type).toBe('fertigation_event');
    expect(events[0].metric).toBe('water-temperature');
    expect(events[0].severity).toBe('WARNING');
    expect(events[0].temperatureCompensationNeeded).toBe(true);
  });

  test('dispatches WARNING when water temperature exceeds the 15-28 degC band', () => {
    const node = new FertigationFogNode();
    const events = node.onReading(waterTempReading('zone-a', 31, '2026-06-01T10:00:00.000Z'));
    expect(events).toHaveLength(1);
    expect(events[0].severity).toBe('WARNING');
    expect(events[0].temperatureCompensationNeeded).toBe(true);
  });

  test('dispatches OK for an in-band reading and omits doseDirection/slope', () => {
    const node = new FertigationFogNode();
    const events = node.onReading(waterTempReading('zone-a', 22, '2026-06-01T10:00:00.000Z'));
    expect(events).toHaveLength(1);
    expect(events[0].severity).toBe('OK');
    expect(events[0].doseDirection).toBeNull();
    expect(events[0].slopePerReading).toBeNull();
    expect(events[0].temperatureCompensationNeeded).toBe(false);
  });

  test('dispatches only on severity transition, not on repeated out-of-band readings', () => {
    const node = new FertigationFogNode();
    const first = node.onReading(waterTempReading('zone-a', 30, '2026-06-01T10:00:00.000Z'));
    expect(first).toHaveLength(1);
    const second = node.onReading(waterTempReading('zone-a', 31, '2026-06-01T10:01:00.000Z'));
    expect(second).toEqual([]);
  });

  test('dispatches an OK recovery transition after water temperature returns in-band', () => {
    const node = new FertigationFogNode();
    node.onReading(waterTempReading('zone-a', 30, '2026-06-01T10:00:00.000Z'));
    const events = node.onReading(waterTempReading('zone-a', 22, '2026-06-01T10:01:00.000Z'));
    expect(events).toHaveLength(1);
    expect(events[0].severity).toBe('OK');
  });
});

describe('FertigationFogNode EC temperature compensation flag', () => {
  test('flags temperatureCompensationNeeded on an EC event when latest water temperature is out of band', () => {
    const node = new FertigationFogNode();
    node.onReading(waterTempReading('zone-a', 32, '2026-06-01T09:59:00.000Z'));
    const events = node.onReading(ecReading('zone-a', 4.0, '2026-06-01T10:00:00.000Z'));
    expect(events[0].temperatureCompensationNeeded).toBe(true);
  });

  test('does not flag temperatureCompensationNeeded on an EC event when water temperature is in band', () => {
    const node = new FertigationFogNode();
    node.onReading(waterTempReading('zone-a', 22, '2026-06-01T09:59:00.000Z'));
    const events = node.onReading(ecReading('zone-a', 4.0, '2026-06-01T10:00:00.000Z'));
    expect(events[0].temperatureCompensationNeeded).toBe(false);
  });

  test('does not flag temperatureCompensationNeeded on an EC event when no water-temperature reading has arrived yet', () => {
    const node = new FertigationFogNode();
    const events = node.onReading(ecReading('zone-a', 4.0, '2026-06-01T10:00:00.000Z'));
    expect(events[0].temperatureCompensationNeeded).toBe(false);
  });

  test('does not attach temperatureCompensationNeeded to pH events', () => {
    const node = new FertigationFogNode();
    node.onReading(waterTempReading('zone-a', 32, '2026-06-01T09:59:00.000Z'));
    const events = node.onReading(phReading('zone-a', 5.0, '2026-06-01T10:00:00.000Z'));
    expect(events[0].temperatureCompensationNeeded).toBeUndefined();
  });
});
