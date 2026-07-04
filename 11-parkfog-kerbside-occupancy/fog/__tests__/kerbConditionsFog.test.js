const { KerbConditionsFog } = require('../kerb-conditions/kerbConditionsFog');

function floodReading(zoneId, value, timestamp) {
  return { scope: 'zone', id: zoneId, metric: 'kerb-flood-level', value, unit: 'mm', timestamp };
}

function evReading(bayId, value, timestamp) {
  return { scope: 'bay', id: bayId, metric: 'ev-charge-state', value, unit: 'enum', timestamp };
}

describe('KerbConditionsFog 4-tier flood band', () => {
  test('no event until the 3-reading window is full', () => {
    const fog = new KerbConditionsFog();
    const e1 = fog.onReading(floodReading('zone-01', 10, 't1'));
    const e2 = fog.onReading(floodReading('zone-01', 10, 't2'));
    expect(e1).toHaveLength(0);
    expect(e2).toHaveLength(0);
  });

  test('dispatches the initial band once the window fills, since currentBand starts null', () => {
    const fog = new KerbConditionsFog();
    fog.onReading(floodReading('zone-01', 10, 't1'));
    fog.onReading(floodReading('zone-01', 10, 't2'));
    const events = fog.onReading(floodReading('zone-01', 10, 't3'));
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ type: 'flood_risk_event', zoneId: 'zone-01', band: 'clear' });
  });

  test('a single spike reading does NOT flip the band when the window average stays in-tier', () => {
    const fog = new KerbConditionsFog();
    fog.onReading(floodReading('zone-02', 30, 't1'));
    fog.onReading(floodReading('zone-02', 30, 't2'));
    fog.onReading(floodReading('zone-02', 30, 't3')); // 'clear' band, average 30

    const spikeEvents = fog.onReading(floodReading('zone-02', 60, 't4'));
    // window = [30, 30, 60], average = 40, still < 50 -> spike absorbed by the 3-reading average
    expect(spikeEvents).toHaveLength(0);
    expect(fog.zones.get('zone-02').currentBand).toBe('clear');
  });

  test('band changes only once the window average genuinely crosses into a new tier', () => {
    const fog = new KerbConditionsFog();
    fog.onReading(floodReading('zone-01', 10, 't1'));
    fog.onReading(floodReading('zone-01', 10, 't2'));
    fog.onReading(floodReading('zone-01', 10, 't3')); // 'clear'

    fog.onReading(floodReading('zone-01', 200, 't4')); // window [10,10,200] avg=73.3 -> 'caution'
    fog.onReading(floodReading('zone-01', 200, 't5')); // window [10,200,200] avg=136.7 -> 'restricted'
    const events = fog.onReading(floodReading('zone-01', 200, 't6')); // window [200,200,200] avg=200 -> 'restricted' still
    expect(events).toHaveLength(0);
  });

  test('all 4 tiers are reachable by average level', () => {
    const fog = new KerbConditionsFog();
    fog.onReading(floodReading('zone-01', 0, 't1'));
    fog.onReading(floodReading('zone-01', 0, 't2'));
    const clear = fog.onReading(floodReading('zone-01', 0, 't3'));
    expect(clear[0].band).toBe('clear');

    // window becomes [0, 0, 80] then [0, 80, 80] (avg 53.3, already 'caution') as readings arrive
    fog.onReading(floodReading('zone-01', 80, 't4'));
    const caution = fog.onReading(floodReading('zone-01', 80, 't5'));
    expect(caution[0].band).toBe('caution');
    fog.onReading(floodReading('zone-01', 80, 't6')); // window [80,80,80] avg 80, still 'caution'

    // window becomes [80, 80, 150] (avg 103.3, still 'caution') then [80, 150, 150] (avg 126.7, 'restricted')
    fog.onReading(floodReading('zone-01', 150, 't7'));
    const restricted = fog.onReading(floodReading('zone-01', 150, 't8'));
    expect(restricted[0].band).toBe('restricted');
    fog.onReading(floodReading('zone-01', 150, 't9')); // window [150,150,150] avg 150, still 'restricted'

    // window becomes [150, 150, 250] (avg 183.3, still 'restricted') then [150, 250, 250] (avg 216.7, 'closed')
    fog.onReading(floodReading('zone-01', 250, 't10'));
    const closed = fog.onReading(floodReading('zone-01', 250, 't11'));
    expect(closed[0].band).toBe('closed');
  });
});

describe('KerbConditionsFog EV fault detection', () => {
  test('does not dispatch before 15 consecutive fault readings', () => {
    const fog = new KerbConditionsFog();
    let events = [];
    for (let i = 0; i < 14; i += 1) {
      events = fog.onReading(evReading('bay-06', 'fault', `t${i}`));
    }
    expect(events).toHaveLength(0);
  });

  test('dispatches ev_fault_event exactly once on the 15th consecutive fault reading', () => {
    const fog = new KerbConditionsFog();
    let lastEvents = [];
    for (let i = 0; i < 15; i += 1) {
      lastEvents = fog.onReading(evReading('bay-06', 'fault', `t${i}`));
    }
    expect(lastEvents).toHaveLength(1);
    expect(lastEvents[0]).toMatchObject({ type: 'ev_fault_event', bayId: 'bay-06' });
  });

  test('does not re-dispatch on further consecutive fault readings after the initial dispatch', () => {
    const fog = new KerbConditionsFog();
    for (let i = 0; i < 15; i += 1) {
      fog.onReading(evReading('bay-06', 'fault', `t${i}`));
    }
    const extra1 = fog.onReading(evReading('bay-06', 'fault', 'extra-1'));
    const extra2 = fog.onReading(evReading('bay-06', 'fault', 'extra-2'));
    expect(extra1).toHaveLength(0);
    expect(extra2).toHaveLength(0);
  });

  test('a non-fault reading resets the consecutive-fault counter', () => {
    const fog = new KerbConditionsFog();
    for (let i = 0; i < 10; i += 1) {
      fog.onReading(evReading('bay-06', 'fault', `t${i}`));
    }
    fog.onReading(evReading('bay-06', 'charging', 'reset'));
    expect(fog.bays.get('bay-06').consecutiveFaults).toBe(0);

    let events = [];
    for (let i = 0; i < 14; i += 1) {
      events = fog.onReading(evReading('bay-06', 'fault', `after-${i}`));
    }
    expect(events).toHaveLength(0);
  });

  test('a fault can re-dispatch after recovering (non-fault) and faulting again for 15 more ticks', () => {
    const fog = new KerbConditionsFog();
    for (let i = 0; i < 15; i += 1) {
      fog.onReading(evReading('bay-06', 'fault', `t${i}`));
    }
    fog.onReading(evReading('bay-06', 'idle', 'recover'));

    let events = [];
    for (let i = 0; i < 15; i += 1) {
      events = fog.onReading(evReading('bay-06', 'fault', `t2-${i}`));
    }
    expect(events).toHaveLength(1);
    expect(events[0].type).toBe('ev_fault_event');
  });
});
