const http = require('http');

// exposes each fog node's real self-report over plain HTTP so the browser dashboard (which
// cannot reach into a Node process directly) can poll it, same origin-per-node as the
// dashboard's 3 separate fog-node ports; no framework needed for one read-only GET route
function startMetricsServer(port, getSnapshot) {
  const server = http.createServer((req, res) => {
    if (req.method !== 'GET' || req.url !== '/metrics') {
      res.writeHead(404, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ message: 'not found' }));
      return;
    }
    res.writeHead(200, {
      'Content-Type': 'application/json',
      'Access-Control-Allow-Origin': '*',
    });
    res.end(JSON.stringify(getSnapshot()));
  });
  server.listen(port);
  return server;
}

module.exports = { startMetricsServer };
