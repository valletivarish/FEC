const { BaySensingFog } = require('../bay-sensing/baySensingFog');

function magReading(bayId, value, timestamp) {
  return { scope: 'bay', id: bayId, metric: 'bay-magnetometer', value, unit: 'uT', timestamp };
}

function irReading(bayId, value, timestamp) {
  return { scope: 'bay', id: bayId, metric: 'bay-infrared', value, unit: 'probability', timestamp };
}

function badgeReading(bayId, value, timestamp) {
  return { scope: 'bay', id: bayId, metric: 'disabled-bay-badge-scan', value, unit: 'bool', timestamp };
}

// low readings first so the window fills before crossing up, then a clean push over the up-threshold
function driveOccupied(fog, bayId) {
  fog.onReading(magReading(bayId, 10, 'd1'));
  fog.onReading(magReading(bayId, 10, 'd2'));
  fog.onReading(irReading(bayId, 1.0, 'd3'));
  fog.onReading(irReading(bayId, 1.0, 'd4'));
  fog.onReading(magReading(bayId, 50, 'd5'));
  return fog.onReading(magReading(bayId, 50, 'd6'));
}

describe('BaySensingFog weighted-fusion vote', () => {
  test('combines magnetometer (0.6) and infrared (0.4), using the latest known value of each', () => {
    const fog = new BaySensingFog({});
    fog.onReading(irReading('bay-01', 0.75, 't1'));
    fog.onReading(magReading('bay-01', 50, 't2'));
    // vote = 1*0.6 + 0.75*0.4 = 0.9
    expect(fog.bays.get('bay-01').voteWindow[1]).toBeCloseTo(0.9, 5);
  });

  test('magnetometer delta at or below 40 contributes 0 signal', () => {
    const fog = new BaySensingFog({});
    fog.onReading(magReading('bay-03', 10, 't1'));
    fog.onReading(magReading('bay-03', 10, 't2'));
    const events = fog.onReading(magReading('bay-03', 10, 't3'));
    // vote stays 0 every tick since |10| is not > 40 and infrared was never seen (defaults to 0)
    expect(events).toHaveLength(0);
    expect(fog.bays.get('bay-03').voteWindow).toEqual([0, 0, 0]);
  });

  test('a sensor that has not fired yet defaults its contribution to 0', () => {
    const fog = new BaySensingFog({});
    fog.onReading(irReading('bay-04', 0.75, 't1'));
    // magnetometer never seen -> 0 contribution; vote = 0*0.6 + 0.75*0.4 = 0.3
    expect(fog.bays.get('bay-04').voteWindow[0]).toBeCloseTo(0.3, 5);
  });
});

describe('BaySensingFog hysteresis state machine', () => {
  test('a window average of exactly 0.6 does not cross the strict up-threshold', () => {
    const fog = new BaySensingFog({});
    fog.onReading(magReading('bay-01', 50, 't1'));
    fog.onReading(magReading('bay-01', 50, 't2'));
    const events = fog.onReading(magReading('bay-01', 50, 't3'));
    // vote = 1*0.6 + 0*0.4 = 0.6 each tick, average = 0.6, not strictly > 0.6
    expect(events).toHaveLength(0);
    expect(fog.bays.get('bay-01').state).toBe('UNOCCUPIED');
  });

  test('transitions UNOCCUPIED -> OCCUPIED once the average strictly exceeds 0.6', () => {
    const fog = new BaySensingFog({});
    const events = driveOccupied(fog, 'bay-02');
    expect(events).toHaveLength(1);
    expect(events[0].state).toBe('OCCUPIED');
  });

  test('a window average safely inside (0.4, 0.6) does NOT flip an UNOCCUPIED bay to OCCUPIED', () => {
    const fog = new BaySensingFog({});
    fog.onReading(irReading('bay-05', 0.75, 't1')); // mag unseen(0), ir=0.75 -> vote 0.3
    fog.onReading(irReading('bay-05', 0.75, 't2')); // vote 0.3 again
    const events = fog.onReading(magReading('bay-05', 50, 't3')); // mag=1, ir=0.75 -> vote 0.9
    // window = [0.3, 0.3, 0.9], average = 0.5, comfortably inside the dead band -> no transition
    expect(events).toHaveLength(0);
    expect(fog.bays.get('bay-05').state).toBe('UNOCCUPIED');
  });

  test('a window average safely inside (0.4, 0.6) does NOT flip an OCCUPIED bay back to UNOCCUPIED', () => {
    const fog = new BaySensingFog({});
    const occEvents = driveOccupied(fog, 'bay-06');
    expect(occEvents[0].state).toBe('OCCUPIED');

    fog.onReading(irReading('bay-06', 0.75, 'e1')); // mag last=1(0.6), ir=0.75(0.3) -> vote 0.9
    fog.onReading(magReading('bay-06', 10, 'e2')); // mag off(0), ir last=0.75(0.3) -> vote 0.3
    const events = fog.onReading(irReading('bay-06', 0.75, 'e3')); // mag=0, ir=0.75 -> vote 0.3
    // window = [0.9, 0.3, 0.3], average = 0.5, comfortably inside the dead band -> no transition
    expect(events).toHaveLength(0);
    expect(fog.bays.get('bay-06').state).toBe('OCCUPIED');
  });
});

describe('BaySensingFog disabled-bay violation flag', () => {
  const bayConfig = { 'bay-05': { isDisabledBay: true } };

  test('no violation flagged on the initial transition to OCCUPIED', () => {
    const fog = new BaySensingFog(bayConfig);
    const events = driveOccupied(fog, 'bay-05');
    expect(events[0].state).toBe('OCCUPIED');
    expect(events[0].disabledBayViolation).toBe(false);
  });

  test('violation flag fires exactly once per violation onset, not on every subsequent tick', () => {
    const fog = new BaySensingFog(bayConfig);
    driveOccupied(fog, 'bay-05');

    // exceed the 20-tick badge-scan countdown while remaining occupied (no transition occurs here)
    for (let i = 0; i < 22; i += 1) {
      fog.onReading(magReading('bay-05', 50, `warmup-${i}`));
    }
    expect(fog.bays.get('bay-05').ticksSinceBadgeScan).toBeGreaterThan(20);

    // cycle out and back in to observe the violation flag onset on the re-occupy transition
    fog.onReading(irReading('bay-05', 0, 'drop-ir'));
    fog.onReading(magReading('bay-05', 10, 'drop-1'));
    const unoccEvents = fog.onReading(magReading('bay-05', 10, 'drop-2'));
    expect(unoccEvents[0].state).toBe('UNOCCUPIED');

    fog.onReading(irReading('bay-05', 1.0, 'rise-ir'));
    fog.onReading(magReading('bay-05', 50, 'rise-1'));
    const reoccupyEvents = fog.onReading(magReading('bay-05', 50, 'rise-2'));
    expect(reoccupyEvents[0].state).toBe('OCCUPIED');
    expect(reoccupyEvents[0].disabledBayViolation).toBe(true);

    // no further transition occurs while still occupied, so no event (and no re-flag) is dispatched
    const nextTick = fog.onReading(magReading('bay-05', 50, 'extra'));
    expect(nextTick).toHaveLength(0);
  });

  test('a badge scan resets the countdown and prevents the violation flag', () => {
    const fog = new BaySensingFog(bayConfig);
    fog.onReading(badgeReading('bay-05', true, 'scan-1'));
    expect(fog.bays.get('bay-05').ticksSinceBadgeScan).toBe(0);

    const events = driveOccupied(fog, 'bay-05');
    expect(events[0].state).toBe('OCCUPIED');
    expect(events[0].disabledBayViolation).toBe(false);
  });

  test('non-disabled bays never raise disabledBayViolation', () => {
    const fog = new BaySensingFog(bayConfig);
    const events = driveOccupied(fog, 'bay-01');
    expect(events[0].disabledBayViolation).toBe(false);
  });
});
