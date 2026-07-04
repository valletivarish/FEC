const http = require('http');

// Dependency-free status endpoint (Node's built-in http) — the dashboard's Fog Node page polls
// this directly, mirroring the pattern of the dashboard hitting the backend API directly.
function startFogStatusServer({ port, getStatus }) {
  const server = http.createServer((req, res) => {
    if (req.method === 'GET' && req.url === '/status') {
      const body = JSON.stringify(getStatus());
      res.writeHead(200, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
      res.end(body);
      return;
    }
    res.writeHead(404, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ message: 'not found' }));
  });

  server.listen(port);
  return server;
}

module.exports = { startFogStatusServer };
