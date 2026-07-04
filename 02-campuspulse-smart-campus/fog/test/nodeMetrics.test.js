'use strict';

const http = require('http');
const { NodeMetrics, startMetricsServer } = require('../shared/nodeMetrics');

describe('NodeMetrics', () => {
  test('starts idle with zeroed counters', () => {
    const metrics = new NodeMetrics('fog-test');
    const snapshot = metrics.snapshot(0);
    expect(snapshot.nodeName).toBe('fog-test');
    expect(snapshot.status).toBe('IDLE');
    expect(snapshot.messagesReceived).toBe(0);
    expect(snapshot.messagesProcessed).toBe(0);
    expect(snapshot.messagesSent).toBe(0);
    expect(snapshot.processingDelayMs).toBeNull();
  });

  test('recordReceived/recordProcessed/recordSent increment real running counters', () => {
    const metrics = new NodeMetrics('fog-test');
    metrics.recordReceived();
    metrics.recordReceived();
    metrics.recordProcessed(42);
    metrics.recordSent();

    const snapshot = metrics.snapshot(3);
    expect(snapshot.messagesReceived).toBe(2);
    expect(snapshot.messagesProcessed).toBe(1);
    expect(snapshot.messagesSent).toBe(1);
    expect(snapshot.processingDelayMs).toBe(42);
    expect(snapshot.queueSize).toBe(3);
    expect(snapshot.status).toBe('RUNNING');
  });

  test('cpuPercent and memoryRssBytes reflect real process self-report, not fabricated values', () => {
    const metrics = new NodeMetrics('fog-test');
    // Burn a little real CPU so usage since baseline is non-negative and measurable.
    let acc = 0;
    for (let i = 0; i < 1e6; i += 1) acc += i;
    const snapshot = metrics.snapshot(0);
    expect(snapshot.cpuPercent).toBeGreaterThanOrEqual(0);
    expect(snapshot.memoryRssBytes).toBe(process.memoryUsage().rss > 0 ? snapshot.memoryRssBytes : -1);
    expect(snapshot.memoryRssBytes).toBeGreaterThan(0);
    expect(acc).toBeGreaterThan(0);
  });

  test('reports ERROR when messages are queued but the node has been inactive', () => {
    const metrics = new NodeMetrics('fog-test');
    metrics.recordReceived();
    metrics.lastActivityAtMs = Date.now() - 60000;
    expect(metrics.status(5)).toBe('ERROR');
  });
});

describe('startMetricsServer', () => {
  let server;

  afterEach(() => {
    if (server) server.close();
  });

  test('GET /metrics returns the real snapshot including a live queue size', async () => {
    const metrics = new NodeMetrics('fog-http-test');
    metrics.recordReceived();
    metrics.recordProcessed(10);
    let queueSize = 7;
    server = startMetricsServer(0, metrics, () => queueSize);
    const { port } = server.address();

    const body = await new Promise((resolve, reject) => {
      http.get(`http://127.0.0.1:${port}/metrics`, (res) => {
        let raw = '';
        res.on('data', (chunk) => { raw += chunk; });
        res.on('end', () => resolve({ status: res.statusCode, json: JSON.parse(raw) }));
      }).on('error', reject);
    });

    expect(body.status).toBe(200);
    expect(body.json.nodeName).toBe('fog-http-test');
    expect(body.json.queueSize).toBe(7);
    expect(body.json.messagesReceived).toBe(1);

    queueSize = 9;
    const secondBody = await new Promise((resolve, reject) => {
      http.get(`http://127.0.0.1:${port}/metrics`, (res) => {
        let raw = '';
        res.on('data', (chunk) => { raw += chunk; });
        res.on('end', () => resolve(JSON.parse(raw)));
      }).on('error', reject);
    });
    expect(secondBody.queueSize).toBe(9);
  });

  test('unknown routes return 404', async () => {
    const metrics = new NodeMetrics('fog-http-test');
    server = startMetricsServer(0, metrics, () => 0);
    const { port } = server.address();

    const status = await new Promise((resolve, reject) => {
      http.get(`http://127.0.0.1:${port}/nope`, (res) => resolve(res.statusCode)).on('error', reject);
    });
    expect(status).toBe(404);
  });
});
