const http = require('http');

// Exposes each fog node's real FogNodeMetrics snapshot for the dashboard's Fog Node page to poll.
// Plain Node http server, deliberately dependency-free since this is diagnostic-only surface area.
function startFogMetricsServer(nodesByName, port) {
  const server = http.createServer((req, res) => {
    if (req.method === 'GET' && req.url === '/metrics') {
      const body = JSON.stringify(
        Object.fromEntries(Object.entries(nodesByName).map(([name, metrics]) => [name, metrics.snapshot()]))
      );
      res.writeHead(200, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
      res.end(body);
      return;
    }
    res.writeHead(404, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'not found' }));
  });
  server.listen(port);
  return server;
}

module.exports = { startFogMetricsServer };
