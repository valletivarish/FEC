const DELAY_WINDOW_SIZE = 20;

// self-report block for one fog node: real process.cpuUsage()/memoryUsage() deltas plus
// running counters, so the dashboard's Fog Node page never renders a fabricated number
class FogNodeMetrics {
  constructor(nodeName) {
    this.nodeName = nodeName;
    this.receivedCount = 0;
    this.processedCount = 0;
    this.sentCount = 0;
    this.queue = [];
    this.processingDelaysMs = [];
    this.lastCpuUsage = process.cpuUsage();
    this.lastCpuSampleAt = process.hrtime.bigint();
  }

  recordReceived() {
    this.receivedCount += 1;
    this.queue.push(1);
  }

  // called once the node's own onReading() logic has actually run against the reading
  recordProcessed(reading) {
    this.processedCount += 1;
    this.queue.shift();
    if (reading && reading.timestamp) {
      const delayMs = Date.now() - new Date(reading.timestamp).getTime();
      if (Number.isFinite(delayMs)) {
        this.processingDelaysMs.push(delayMs);
        if (this.processingDelaysMs.length > DELAY_WINDOW_SIZE) {
          this.processingDelaysMs.shift();
        }
      }
    }
  }

  recordSent(count = 1) {
    this.sentCount += count;
  }

  get queueSize() {
    return this.queue.length;
  }

  get averageProcessingDelayMs() {
    if (this.processingDelaysMs.length === 0) return 0;
    const sum = this.processingDelaysMs.reduce((a, b) => a + b, 0);
    return Math.round(sum / this.processingDelaysMs.length);
  }

  // real CPU percentage: microseconds of CPU time consumed since the last sample, over
  // wall-clock microseconds elapsed — the same technique Node's own perf tooling uses
  cpuPercent() {
    const usage = process.cpuUsage(this.lastCpuUsage);
    const now = process.hrtime.bigint();
    const elapsedUs = Number(now - this.lastCpuSampleAt) / 1000;
    this.lastCpuUsage = process.cpuUsage();
    this.lastCpuSampleAt = now;
    if (elapsedUs <= 0) return 0;
    const cpuUs = usage.user + usage.system;
    return Math.round((cpuUs / elapsedUs) * 1000) / 10;
  }

  snapshot() {
    const mem = process.memoryUsage();
    return {
      nodeName: this.nodeName,
      status: this.receivedCount > 0 ? 'Running' : 'Idle',
      cpuPercent: this.cpuPercent(),
      memoryUsedMb: Math.round((mem.rss / (1024 * 1024)) * 10) / 10,
      heapUsedMb: Math.round((mem.heapUsed / (1024 * 1024)) * 10) / 10,
      receivedCount: this.receivedCount,
      processedCount: this.processedCount,
      sentCount: this.sentCount,
      queueSize: this.queueSize,
      averageProcessingDelayMs: this.averageProcessingDelayMs,
    };
  }
}

module.exports = { FogNodeMetrics };
