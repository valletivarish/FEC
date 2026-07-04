const { ChargerBayAgent } = require('../bay-agent/chargerBaySetpoint');

const HUB_ID = 'hub-01';
const BAY_ID = 'bay-01';
const BASE_TS = '2026-01-01T00:00:00.000Z';

function socReading(value, timestamp = BASE_TS) {
  return { hubId: HUB_ID, bayId: BAY_ID, metric: 'bay/ev-soc', value, unit: '%', timestamp };
}

function stateReading(value, timestamp = BASE_TS) {
  return { hubId: HUB_ID, bayId: BAY_ID, metric: 'bay/connector-state', value, unit: 'enum', timestamp };
}

describe('ChargerBayAgent taper curve boundaries', () => {
  test('0% soc yields full 32A setpoint', () => {
    const agent = new ChargerBayAgent();
    const events = agent.onReading(socReading(0));
    expect(events).toHaveLength(1);
    expect(events[0].setpointAmps).toBe(32);
  });

  test('79% soc still yields full 32A (below taper start)', () => {
    const agent = new ChargerBayAgent();
    const events = agent.onReading(socReading(79));
    expect(events[0].setpointAmps).toBe(32);
  });

  test('80% soc is the exact taper start, still 32A', () => {
    const agent = new ChargerBayAgent();
    const events = agent.onReading(socReading(80));
    expect(events[0].setpointAmps).toBe(32);
  });

  test('90% soc is the taper midpoint: 19A', () => {
    const agent = new ChargerBayAgent();
    const events = agent.onReading(socReading(90));
    expect(events[0].setpointAmps).toBeCloseTo(19, 5);
  });

  test('100% soc yields the taper floor of 6A', () => {
    const agent = new ChargerBayAgent();
    const events = agent.onReading(socReading(100));
    expect(events[0].setpointAmps).toBe(6);
  });

  test('taper is unaffected by connector-state charging vs plugged', () => {
    const agentA = new ChargerBayAgent();
    agentA.onReading(stateReading('charging'));
    const eventsA = agentA.onReading(socReading(90, '2026-01-01T00:00:01.000Z'));

    const agentB = new ChargerBayAgent();
    agentB.onReading(stateReading('plugged'));
    const eventsB = agentB.onReading(socReading(90, '2026-01-01T00:00:01.000Z'));

    expect(eventsA[0].setpointAmps).toBeCloseTo(19, 5);
    expect(eventsB[0].setpointAmps).toBeCloseTo(19, 5);
  });
});

describe('ChargerBayAgent fault/unplugged zeroing', () => {
  test('fault state forces 0A even mid-taper', () => {
    const agent = new ChargerBayAgent();
    agent.onReading(socReading(50, BASE_TS));
    const events = agent.onReading(stateReading('fault', '2026-01-01T00:00:01.000Z'));
    expect(events).toHaveLength(1);
    expect(events[0].setpointAmps).toBe(0);
  });

  test('unplugged state forces 0A', () => {
    const agent = new ChargerBayAgent();
    agent.onReading(socReading(10, BASE_TS));
    const events = agent.onReading(stateReading('unplugged', '2026-01-01T00:00:01.000Z'));
    expect(events).toHaveLength(1);
    expect(events[0].setpointAmps).toBe(0);
  });

  test('plugged (non-fault, non-charging) uses the normal taper curve', () => {
    const agent = new ChargerBayAgent();
    const events = agent.onReading(stateReading('plugged', BASE_TS));
    expect(events[0].setpointAmps).toBe(32);
  });
});

describe('ChargerBayAgent curtailment ceiling', () => {
  test('applyCurtailmentCeiling caps setpoint downward, never overrides upward', () => {
    const agent = new ChargerBayAgent();
    agent.onReading(socReading(0, BASE_TS));

    agent.applyCurtailmentCeiling(BAY_ID, 12.8);
    const events = agent.onReading(socReading(1, '2026-01-01T00:00:01.000Z'));
    expect(events[0].setpointAmps).toBe(12.8);
  });

  test('a ceiling above the natural setpoint does not raise it', () => {
    const agent = new ChargerBayAgent();
    agent.applyCurtailmentCeiling(BAY_ID, 25.6);
    const events = agent.onReading(socReading(95, BASE_TS));
    // taper at 95% = 32 - 0.75*(26) = 12.5, ceiling of 25.6 must not raise it
    expect(events[0].setpointAmps).toBeCloseTo(12.5, 5);
  });

  test('ceiling of 0 zeros the setpoint regardless of soc', () => {
    const agent = new ChargerBayAgent();
    agent.applyCurtailmentCeiling(BAY_ID, 0);
    const events = agent.onReading(socReading(0, BASE_TS));
    expect(events[0].setpointAmps).toBe(0);
  });
});

describe('ChargerBayAgent dispatch gating', () => {
  test('does not dispatch when setpoint changes by 1A or less', () => {
    const agent = new ChargerBayAgent();
    agent.onReading(socReading(80, BASE_TS)); // 32A, dispatched
    const events = agent.onReading(socReading(80.5, '2026-01-01T00:00:01.000Z')); // tiny change
    expect(events).toHaveLength(0);
  });

  test('dispatches a heartbeat every 60s of sim time even without a setpoint change', () => {
    const agent = new ChargerBayAgent();
    agent.onReading(socReading(80, '2026-01-01T00:00:00.000Z'));
    const noHeartbeat = agent.onReading(socReading(80, '2026-01-01T00:00:30.000Z'));
    expect(noHeartbeat).toHaveLength(0);
    const heartbeat = agent.onReading(socReading(80, '2026-01-01T00:01:00.000Z'));
    expect(heartbeat).toHaveLength(1);
  });
});
