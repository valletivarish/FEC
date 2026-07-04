'use strict';

const http = require('http');
const { startStatusServer, routeReading } = require('../index');
const { NodeMetrics } = require('../shared/nodeMetrics');
const { OccupancyFog } = require('../fog-occupancy/reconcile');
const { ComfortFog } = require('../fog-comfort/ventilationAnomaly');
const { UsageFog } = require('../fog-usage/deviceLeftOn');
const { FakeZoneEventDispatcher } = require('./helpers/fakeDispatcher');

function get(port, path) {
  return new Promise((resolve, reject) => {
    http.get(`http://127.0.0.1:${port}${path}`, (res) => {
      let raw = '';
      res.on('data', (chunk) => { raw += chunk; });
      res.on('end', () => resolve({ statusCode: res.statusCode, body: raw }));
    }).on('error', reject);
  });
}

describe('fog status HTTP server', () => {
  let server;
  const port = 3199;

  afterEach((done) => {
    if (server) server.close(done);
    else done();
  });

  test('GET /fog/status returns a snapshot per fog node', async () => {
    const metrics = {
      occupancyFog: new NodeMetrics('OccupancyFog'),
      comfortFog: new NodeMetrics('ComfortFog'),
      usageFog: new NodeMetrics('UsageFog'),
    };
    server = startStatusServer(metrics, port);

    const response = await get(port, '/fog/status');
    expect(response.statusCode).toBe(200);
    const body = JSON.parse(response.body);
    expect(body.nodes).toHaveLength(3);
    expect(body.nodes.map((n) => n.nodeName).sort()).toEqual(['ComfortFog', 'OccupancyFog', 'UsageFog']);
  });

  test('unknown paths return 404', async () => {
    const metrics = { occupancyFog: new NodeMetrics('OccupancyFog') };
    server = startStatusServer(metrics, port + 1);

    const response = await get(port + 1, '/nope');
    expect(response.statusCode).toBe(404);
  });

  test('status reflects real routed traffic end to end', async () => {
    const metrics = {
      occupancyFog: new NodeMetrics('OccupancyFog'),
      comfortFog: new NodeMetrics('ComfortFog'),
      usageFog: new NodeMetrics('UsageFog'),
    };
    const nodes = { occupancyFog: new OccupancyFog(), comfortFog: new ComfortFog(), usageFog: new UsageFog() };
    const dispatcher = new FakeZoneEventDispatcher();

    await routeReading({ zoneId: 'zone-101', metric: 'desk-occupancy', value: 6, timestamp: new Date().toISOString() }, nodes, dispatcher, metrics);
    await routeReading({ zoneId: 'zone-101', metric: 'people-counter', value: 1, timestamp: new Date().toISOString() }, nodes, dispatcher, metrics);

    server = startStatusServer(metrics, port + 2);
    const response = await get(port + 2, '/fog/status');
    const body = JSON.parse(response.body);
    const occupancy = body.nodes.find((n) => n.nodeName === 'OccupancyFog');

    expect(occupancy.messagesReceived).toBe(2);
    expect(occupancy.messagesProcessed).toBe(2);
    expect(occupancy.status).toBe('Running');
    // desk-occupancy also routes to UsageFog
    const usage = body.nodes.find((n) => n.nodeName === 'UsageFog');
    expect(usage.messagesReceived).toBe(1);
  });
});
