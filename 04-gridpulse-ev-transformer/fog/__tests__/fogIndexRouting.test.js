const { routeReading, buildBayAgents, buildNodeMetrics, buildStatusPayload } = require('../index');
const { TransformerGuardAgent } = require('../transformer-guard/transformerCurtailment');
const { DerBalancerAgent } = require('../der-balancer/derDispatchPlanner');
const { FakeDispatchClient } = require('./testUtils/fakeDispatchClient');

function buildHarness() {
  const bayAgents = buildBayAgents();
  const transformerGuard = new TransformerGuardAgent(bayAgents);
  const derBalancer = new DerBalancerAgent();
  const dispatchClient = new FakeDispatchClient();
  const nodeMetrics = buildNodeMetrics();
  return {
    bayAgents, transformerGuard, derBalancer, dispatchClient, nodeMetrics,
  };
}

describe('routeReading node-metrics wiring', () => {
  test('a bay reading increments only the bay node group counters', () => {
    const h = buildHarness();
    const reading = {
      hubId: 'hub-01', bayId: 'bay-01', metric: 'bay/connector-state', value: 'charging', timestamp: '2026-07-05T00:00:00.000Z',
    };
    routeReading(reading, h.bayAgents, h.transformerGuard, h.derBalancer, h.dispatchClient, h.nodeMetrics);

    expect(h.nodeMetrics.bay.messagesReceived).toBe(1);
    expect(h.nodeMetrics.bay.messagesProcessed).toBe(1);
    expect(h.nodeMetrics.transformer.messagesReceived).toBe(0);
    expect(h.nodeMetrics.der.messagesReceived).toBe(0);
  });

  test('a feeder reading counts against the transformer node group, same as a transformer reading', () => {
    const h = buildHarness();
    const reading = {
      hubId: 'hub-01', bayId: null, metric: 'feeder/voltage', value: 230, timestamp: '2026-07-05T00:00:00.000Z',
    };
    routeReading(reading, h.bayAgents, h.transformerGuard, h.derBalancer, h.dispatchClient, h.nodeMetrics);

    expect(h.nodeMetrics.transformer.messagesReceived).toBe(1);
    expect(h.nodeMetrics.bay.messagesReceived).toBe(0);
  });

  test('a dispatched event bumps messagesSent on the owning node once the dispatch settles', async () => {
    const h = buildHarness();
    const reading = {
      hubId: 'hub-01', bayId: null, metric: 'feeder/voltage', value: 230, timestamp: '2026-07-05T00:00:00.000Z',
    };
    routeReading(reading, h.bayAgents, h.transformerGuard, h.derBalancer, h.dispatchClient, h.nodeMetrics);

    // dispatch resolves asynchronously; flush microtasks before asserting the settled counter
    await Promise.resolve();
    await Promise.resolve();

    expect(h.nodeMetrics.transformer.messagesSent).toBe(1);
    expect(h.dispatchClient.dispatched).toHaveLength(1);
  });

  test('routeReading works with no nodeMetrics argument (backward compatible default)', () => {
    const h = buildHarness();
    const reading = {
      hubId: 'hub-01', bayId: 'bay-01', metric: 'bay/ev-soc', value: 50, timestamp: '2026-07-05T00:00:00.000Z',
    };
    expect(() => routeReading(reading, h.bayAgents, h.transformerGuard, h.derBalancer, h.dispatchClient)).not.toThrow();
  });
});

describe('buildStatusPayload', () => {
  test('reports a snapshot per node group plus one process-wide resource sample', () => {
    const nodeMetrics = buildNodeMetrics();
    const fakeSampler = { sample: () => ({ cpuPercent: 1.5, memoryRssBytes: 12345 }) };

    const payload = buildStatusPayload(nodeMetrics, fakeSampler);

    expect(payload.nodes).toHaveLength(3);
    expect(payload.nodes.map((n) => n.nodeName).sort()).toEqual(
      ['ChargerBayAgentFog', 'DerBalancerFog', 'TransformerGuardFog'].sort(),
    );
    expect(payload.process).toEqual({ cpuPercent: 1.5, memoryRssBytes: 12345 });
  });
});
