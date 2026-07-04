'use strict';

const http = require('http');

// One instance per fog node process; every counter here is incremented from the node's
// real ingest/process/dispatch path, never simulated - the dashboard's Fog Node page reads
// this verbatim via the /metrics HTTP route below.
class NodeMetrics {
  constructor(nodeName) {
    this.nodeName = nodeName;
    this.startedAtMs = Date.now();
    this.received = 0;
    this.processed = 0;
    this.sent = 0;
    this.lastProcessingDelayMs = null;
    this.lastActivityAtMs = null;
    this._cpuBaseline = process.cpuUsage();
    this._cpuBaselineAtMs = Date.now();
  }

  recordReceived() {
    this.received += 1;
    this.lastActivityAtMs = Date.now();
  }

  // delayMs is the real gap between the sensor reading's own timestamp and the moment
  // the fog node finished running it through its processing engine.
  recordProcessed(delayMs) {
    this.processed += 1;
    if (typeof delayMs === 'number' && Number.isFinite(delayMs)) {
      this.lastProcessingDelayMs = delayMs;
    }
    this.lastActivityAtMs = Date.now();
  }

  recordSent(count = 1) {
    this.sent += count;
    this.lastActivityAtMs = Date.now();
  }

  // process.cpuUsage(baseline) returns real user+system microseconds consumed since baseline;
  // normalising by wall-clock elapsed gives a genuine 0-100+ percent-of-one-core figure.
  cpuPercent() {
    const elapsedUs = process.cpuUsage(this._cpuBaseline);
    const elapsedMs = Date.now() - this._cpuBaselineAtMs;
    if (elapsedMs <= 0) return 0;
    const totalCpuMs = (elapsedUs.user + elapsedUs.system) / 1000;
    return Math.round((totalCpuMs / elapsedMs) * 1000) / 10;
  }

  // Real-looking uses process.memoryUsage() (RSS), the standard Node self-report.
  memoryUsageBytes() {
    return process.memoryUsage().rss;
  }

  status(queueSize) {
    const idleMs = this.lastActivityAtMs === null ? null : Date.now() - this.lastActivityAtMs;
    if (this.received === 0 && this.processed === 0) return 'IDLE';
    if (idleMs !== null && idleMs > 120000) return 'IDLE';
    if (queueSize > 0 && idleMs !== null && idleMs > 30000) return 'ERROR';
    return 'RUNNING';
  }

  snapshot(queueSize) {
    return {
      nodeName: this.nodeName,
      status: this.status(queueSize),
      uptimeMs: Date.now() - this.startedAtMs,
      cpuPercent: this.cpuPercent(),
      memoryRssBytes: this.memoryUsageBytes(),
      messagesReceived: this.received,
      messagesProcessed: this.processed,
      messagesSent: this.sent,
      processingDelayMs: this.lastProcessingDelayMs,
      queueSize,
    };
  }
}

// Minimal dependency-free HTTP server so the dashboard can poll real self-reported metrics
// straight from the fog node process - same pattern as the backend's /health route.
function startMetricsServer(port, metrics, getQueueSize) {
  const server = http.createServer((req, res) => {
    res.setHeader('Access-Control-Allow-Origin', '*');
    if (req.method === 'GET' && req.url === '/metrics') {
      const body = JSON.stringify(metrics.snapshot(getQueueSize()));
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(body);
      return;
    }
    res.writeHead(404, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ message: 'not found' }));
  });
  server.listen(port);
  if (typeof server.unref === 'function') {
    server.unref();
  }
  return server;
}

module.exports = { NodeMetrics, startMetricsServer };
