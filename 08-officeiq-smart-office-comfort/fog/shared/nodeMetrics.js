'use strict';

// Real self-report per fog node: process.cpuUsage()/memoryUsage() are OS-reported, not fabricated.
// One instance per named fog node (OccupancyFog/ComfortFog/UsageFog) since all three run in this process.
class NodeMetrics {
  constructor(nodeName) {
    this.nodeName = nodeName;
    this.received = 0;
    this.processed = 0;
    this.sent = 0;
    this.queueDepth = 0;
    this._lastDelayMs = null;
    this._lastCpuUsage = process.cpuUsage();
    this._lastCpuSampleAt = Date.now();
    this._lastCpuPercent = 0;
  }

  recordReceived() {
    this.received += 1;
    this.queueDepth += 1;
  }

  recordProcessed() {
    this.processed += 1;
    this.queueDepth = Math.max(0, this.queueDepth - 1);
  }

  recordDispatch(reading) {
    this.sent += 1;
    if (reading && reading.timestamp) {
      const sensorTime = new Date(reading.timestamp).getTime();
      if (!Number.isNaN(sensorTime)) {
        this._lastDelayMs = Date.now() - sensorTime;
      }
    }
  }

  // % of one core consumed since the last sample — same technique psutil/OperatingSystemMXBean use
  _sampleCpuPercent() {
    const now = Date.now();
    const elapsedMs = now - this._lastCpuSampleAt;
    if (elapsedMs <= 0) return this._lastCpuPercent;

    const usage = process.cpuUsage(this._lastCpuUsage);
    const usedMicros = usage.user + usage.system;
    const percent = (usedMicros / 1000 / elapsedMs) * 100;

    this._lastCpuUsage = process.cpuUsage();
    this._lastCpuSampleAt = now;
    this._lastCpuPercent = Math.round(percent * 100) / 100;
    return this._lastCpuPercent;
  }

  snapshot() {
    const mem = process.memoryUsage();
    return {
      nodeName: this.nodeName,
      status: this.received > 0 ? 'Running' : 'Idle',
      cpuPercent: this._sampleCpuPercent(),
      memoryRssMb: Math.round((mem.rss / (1024 * 1024)) * 100) / 100,
      messagesReceived: this.received,
      messagesProcessed: this.processed,
      messagesSent: this.sent,
      queueDepth: this.queueDepth,
      processingDelayMs: this._lastDelayMs,
    };
  }
}

module.exports = { NodeMetrics };
