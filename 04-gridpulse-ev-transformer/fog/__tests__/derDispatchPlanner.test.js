const { DerBalancerAgent } = require('../der-balancer/derDispatchPlanner');

const HUB_ID = 'hub-01';

function solarReading(value, timestamp) {
  return { hubId: HUB_ID, bayId: null, metric: 'der/solar-generation', value, unit: 'kW', timestamp };
}

function socReading(value, timestamp) {
  return { hubId: HUB_ID, bayId: null, metric: 'der/battery-soc', value, unit: '%', timestamp };
}

function tariffReading(value, timestamp) {
  return { hubId: HUB_ID, bayId: null, metric: 'der/tariff-price', value, unit: 'pence/kWh', timestamp };
}

function ts(n) {
  return `2026-01-01T00:00:${String(n).padStart(2, '0')}.000Z`;
}

describe('DerBalancerAgent mode branches', () => {
  test('charge_battery_from_solar when solar > 2kW and battery < 95%', () => {
    const agent = new DerBalancerAgent();
    agent.onReading(socReading(50, ts(0)));
    agent.onReading(tariffReading(20, ts(1)));
    const events = agent.onReading(solarReading(5, ts(2)));
    const modeEvent = events.find((e) => e.type === 'der_mode');
    expect(modeEvent.mode).toBe('charge_battery_from_solar');
  });

  test('discharge_to_grid when tariff is in top quartile of window and battery > 20%', () => {
    const agent = new DerBalancerAgent();
    agent.onReading(solarReading(0, ts(0)));
    agent.onReading(socReading(50, ts(1)));
    // Build a full 20-sample window of mid-range prices first so the quartile split is meaningful.
    const midPrices = Array.from({ length: 20 }, (_, i) => 20 + (i % 5));
    midPrices.forEach((p) => agent.onReading(tariffReading(p, ts(2))));
    agent.onReading(tariffReading(100, ts(3)));
    expect(agent.mode).toBe('discharge_to_grid');
  });

  test('opportunistic_charge when tariff is in bottom quartile of window and battery < 95%', () => {
    const agent = new DerBalancerAgent();
    agent.onReading(solarReading(0, ts(0)));
    agent.onReading(socReading(50, ts(1)));
    const midPrices = Array.from({ length: 20 }, (_, i) => 20 + (i % 5));
    midPrices.forEach((p) => agent.onReading(tariffReading(p, ts(2))));
    const events = agent.onReading(tariffReading(1, ts(3)));
    const modeEvent = events.find((e) => e.type === 'der_mode');
    expect(modeEvent.mode).toBe('opportunistic_charge');
  });

  test('idle when tariff sits mid-window and battery is mid-range', () => {
    const agent = new DerBalancerAgent();
    agent.onReading(solarReading(0, ts(0)));
    agent.onReading(socReading(50, ts(1)));
    const midPrices = Array.from({ length: 20 }, (_, i) => 10 + i); // spread 10..29
    midPrices.forEach((p) => agent.onReading(tariffReading(p, ts(2))));
    // Push one more mid-range price; window now spans a wide range so 19 sits in the interquartile zone.
    const events = agent.onReading(tariffReading(19, ts(3)));
    const modeEvent = events.find((e) => e.type === 'der_mode');
    expect(agent.mode).toBe('idle');
    if (modeEvent) expect(modeEvent.mode).toBe('idle');
  });

  test('battery >= 95% blocks charge_battery_from_solar even with abundant solar', () => {
    const agent = new DerBalancerAgent();
    agent.onReading(socReading(96, ts(0)));
    agent.onReading(solarReading(0, ts(0)));
    const events = agent.onReading(solarReading(10, ts(1)));
    // charge_battery_from_solar never fires; mode falls through to idle since tariff is unset.
    const modeEvent = events.find((e) => e.type === 'der_mode');
    expect(modeEvent).toBeUndefined();
    expect(agent.mode).toBe('idle');
  });

  test('battery <= 20% blocks discharge_to_grid even at top-quartile tariff', () => {
    const agent = new DerBalancerAgent();
    agent.onReading(solarReading(0, ts(0)));
    agent.onReading(socReading(15, ts(1)));
    const midPrices = Array.from({ length: 20 }, (_, i) => 20 + (i % 5));
    midPrices.forEach((p) => agent.onReading(tariffReading(p, ts(2))));
    const events = agent.onReading(tariffReading(100, ts(3)));
    const modeEvent = events.find((e) => e.type === 'der_mode');
    expect(modeEvent).toBeUndefined();
    expect(agent.mode).toBe('idle');
  });
});

describe('DerBalancerAgent mode transitions and summary cadence', () => {
  test('only dispatches der_mode on an actual mode change', () => {
    const agent = new DerBalancerAgent();
    agent.onReading(socReading(50, ts(0)));
    agent.onReading(tariffReading(20, ts(1)));
    const first = agent.onReading(solarReading(5, ts(2)));
    expect(first.some((e) => e.type === 'der_mode')).toBe(true);
    const second = agent.onReading(solarReading(6, ts(3))); // still charge_battery_from_solar
    expect(second.some((e) => e.type === 'der_mode')).toBe(false);
  });

  test('emits a der_summary every 5th reading using a simple counter', () => {
    const agent = new DerBalancerAgent();
    const allEvents = [];
    for (let i = 0; i < 5; i++) {
      allEvents.push(...agent.onReading(solarReading(1, ts(i))));
    }
    const summaries = allEvents.filter((e) => e.type === 'der_summary');
    expect(summaries).toHaveLength(1);
  });

  test('emits summaries at readings 5, 10, 15 (not tied to wall-clock)', () => {
    const agent = new DerBalancerAgent();
    let summaryCount = 0;
    for (let i = 0; i < 15; i++) {
      const events = agent.onReading(solarReading(1, ts(i % 60)));
      summaryCount += events.filter((e) => e.type === 'der_summary').length;
    }
    expect(summaryCount).toBe(3);
  });
});
