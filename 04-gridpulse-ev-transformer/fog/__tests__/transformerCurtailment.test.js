const { TransformerGuardAgent } = require('../transformer-guard/transformerCurtailment');
const { ChargerBayAgent } = require('../bay-agent/chargerBaySetpoint');

const HUB_ID = 'hub-01';
const BAY_IDS = ['bay-01', 'bay-02', 'bay-03', 'bay-04', 'bay-05', 'bay-06'];

function buildBayAgents() {
  const map = new Map();
  for (const bayId of BAY_IDS) map.set(bayId, new ChargerBayAgent());
  return map;
}

function loadReading(value, timestamp) {
  return { hubId: HUB_ID, bayId: null, metric: 'transformer/load-amps', value, unit: 'A', timestamp };
}

function tempReading(value, timestamp) {
  return { hubId: HUB_ID, bayId: null, metric: 'transformer/winding-temp', value, unit: 'degC', timestamp };
}

function ts(n) {
  return `2026-01-01T00:00:${String(n).padStart(2, '0')}.000Z`;
}

describe('TransformerGuardAgent rung transition table', () => {
  test('load < 320A and temp < 100C stays at rung 0 normal, no event', () => {
    const bayAgents = buildBayAgents();
    const guard = new TransformerGuardAgent(bayAgents);
    const events = guard.onReading(loadReading(100, ts(0)));
    expect(events).toHaveLength(0);
    expect(guard.currentRung).toBe(0);
  });

  test('load 320-360A escalates immediately to rung 1 advisory and caps bays at 25.6A', () => {
    const bayAgents = buildBayAgents();
    const guard = new TransformerGuardAgent(bayAgents);
    const events = guard.onReading(loadReading(330, ts(0)));
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ type: 'curtailment_event', rung: 1, rungLabel: 'advisory', shedBayId: null });
    for (const bayId of BAY_IDS) {
      expect(bayAgents.get(bayId).curtailmentCeiling.get(bayId)).toBeCloseTo(25.6, 5);
    }
  });

  test('temp 100-110C also escalates to rung 1 advisory', () => {
    const bayAgents = buildBayAgents();
    const guard = new TransformerGuardAgent(bayAgents);
    const events = guard.onReading(tempReading(105, ts(0)));
    expect(events[0].rung).toBe(1);
  });

  test('load 360-390A escalates to rung 2 curtail, caps at 12.8A and sheds lowest-soc bay', () => {
    const bayAgents = buildBayAgents();
    // Seed differing soc levels so a clear lowest exists.
    bayAgents.get('bay-01').evSoc.set('bay-01', 90);
    bayAgents.get('bay-02').evSoc.set('bay-02', 15);
    bayAgents.get('bay-03').evSoc.set('bay-03', 50);
    const guard = new TransformerGuardAgent(bayAgents);
    const events = guard.onReading(loadReading(370, ts(0)));
    expect(events).toHaveLength(1);
    expect(events[0].rung).toBe(2);
    expect(events[0].rungLabel).toBe('curtail');
    expect(events[0].shedBayId).toBe('bay-02');
    expect(bayAgents.get('bay-02').curtailmentCeiling.get('bay-02')).toBe(0);
    expect(bayAgents.get('bay-01').curtailmentCeiling.get('bay-01')).toBeCloseTo(12.8, 5);
  });

  test('load >= 390A escalates to rung 3 trip, all bays 0A', () => {
    const bayAgents = buildBayAgents();
    const guard = new TransformerGuardAgent(bayAgents);
    const events = guard.onReading(loadReading(400, ts(0)));
    expect(events[0].rung).toBe(3);
    expect(events[0].rungLabel).toBe('trip');
    for (const bayId of BAY_IDS) {
      expect(bayAgents.get(bayId).curtailmentCeiling.get(bayId)).toBe(0);
    }
  });

  test('temp >= 120C also escalates to rung 3 trip', () => {
    const bayAgents = buildBayAgents();
    const guard = new TransformerGuardAgent(bayAgents);
    const events = guard.onReading(tempReading(125, ts(0)));
    expect(events[0].rung).toBe(3);
  });

  test('escalation across two rungs at once (e.g. 0 -> 3) fires a single transition event', () => {
    const bayAgents = buildBayAgents();
    const guard = new TransformerGuardAgent(bayAgents);
    const events = guard.onReading(loadReading(395, ts(0)));
    expect(events).toHaveLength(1);
    expect(events[0].rung).toBe(3);
  });
});

describe('TransformerGuardAgent de-escalation hysteresis', () => {
  test('does NOT de-escalate on only 1 lower sample', () => {
    const bayAgents = buildBayAgents();
    const guard = new TransformerGuardAgent(bayAgents);
    guard.onReading(loadReading(400, ts(0))); // rung 3
    const events = guard.onReading(loadReading(100, ts(1))); // 1 lower sample
    expect(events).toHaveLength(0);
    expect(guard.currentRung).toBe(3);
  });

  test('does NOT de-escalate on only 2 lower samples', () => {
    const bayAgents = buildBayAgents();
    const guard = new TransformerGuardAgent(bayAgents);
    guard.onReading(loadReading(400, ts(0))); // rung 3
    guard.onReading(loadReading(100, ts(1)));
    const events = guard.onReading(loadReading(100, ts(2)));
    expect(events).toHaveLength(0);
    expect(guard.currentRung).toBe(3);
  });

  test('DOES de-escalate on the 3rd consecutive lower sample', () => {
    const bayAgents = buildBayAgents();
    const guard = new TransformerGuardAgent(bayAgents);
    guard.onReading(loadReading(400, ts(0))); // rung 3
    guard.onReading(loadReading(100, ts(1)));
    guard.onReading(loadReading(100, ts(2)));
    const events = guard.onReading(loadReading(100, ts(3)));
    expect(events).toHaveLength(1);
    expect(events[0].rung).toBe(0);
    expect(guard.currentRung).toBe(0);
  });

  test('a streak-breaking higher sample resets the de-escalation counter', () => {
    const bayAgents = buildBayAgents();
    const guard = new TransformerGuardAgent(bayAgents);
    guard.onReading(loadReading(400, ts(0))); // rung 3
    guard.onReading(loadReading(100, ts(1))); // streak 1 toward rung 0
    guard.onReading(loadReading(100, ts(2))); // streak 2 toward rung 0
    guard.onReading(loadReading(400, ts(3))); // back to rung 3, resets streak, no-op transition (already 3)
    guard.onReading(loadReading(100, ts(4))); // streak 1
    guard.onReading(loadReading(100, ts(5))); // streak 2
    const events = guard.onReading(loadReading(100, ts(6))); // streak 3 -> de-escalate
    expect(events).toHaveLength(1);
    expect(guard.currentRung).toBe(0);
  });
});
