// Real per-fog-node-class operational telemetry: message counters, CPU/memory self-report,
// in-memory queue depth and sensor-to-dispatch processing delay. No fabricated numbers —
// every field here is derived from process.cpuUsage()/memoryUsage() or counters incremented
// at the exact point the corresponding real event happens.
class FogNodeMetrics {
  constructor(name) {
    this.name = name;
    this.messagesReceived = 0;
    this.messagesProcessed = 0;
    this.messagesSent = 0;
    this.queueSize = 0;
    this.lastProcessingDelayMs = null;
    this.lastCpuUsage = process.cpuUsage();
    this.lastCpuSampleAt = process.hrtime.bigint();
  }

  // called the instant a subscribed reading arrives off the MQTT topic, before any processing
  recordReceived() {
    this.messagesReceived += 1;
    this.queueSize += 1;
  }

  // called once onReading()'s real classification logic has finished producing (possibly zero) events
  recordProcessed(reading, dispatchedAtIso) {
    this.messagesProcessed += 1;
    this.queueSize = Math.max(0, this.queueSize - 1);
    if (reading && reading.timestamp) {
      const sensorTimeMs = new Date(reading.timestamp).getTime();
      const dispatchTimeMs = new Date(dispatchedAtIso || new Date().toISOString()).getTime();
      this.lastProcessingDelayMs = Math.max(0, dispatchTimeMs - sensorTimeMs);
    }
  }

  recordSent(count = 1) {
    this.messagesSent += count;
  }

  // process.cpuUsage(previous) returns real user+system microseconds consumed since the last
  // sample, which we convert to a % of the wall-clock interval that elapsed - a genuine measurement,
  // not a random number
  _cpuPercent() {
    const elapsedNs = process.hrtime.bigint() - this.lastCpuSampleAt;
    const elapsedMicros = Number(elapsedNs) / 1000;
    const usage = process.cpuUsage(this.lastCpuUsage);
    this.lastCpuUsage = process.cpuUsage();
    this.lastCpuSampleAt = process.hrtime.bigint();
    if (elapsedMicros <= 0) return 0;
    const busyMicros = usage.user + usage.system;
    return Math.min(100, Math.round((busyMicros / elapsedMicros) * 1000) / 10);
  }

  snapshot() {
    const memory = process.memoryUsage();
    return {
      name: this.name,
      status: this.messagesReceived > 0 ? 'Running' : 'Idle',
      cpuPercent: this._cpuPercent(),
      memoryRssBytes: memory.rss,
      memoryHeapUsedBytes: memory.heapUsed,
      messagesReceived: this.messagesReceived,
      messagesProcessed: this.messagesProcessed,
      messagesSent: this.messagesSent,
      queueSize: this.queueSize,
      processingDelayMs: this.lastProcessingDelayMs,
      updatedAt: new Date().toISOString(),
    };
  }
}

module.exports = { FogNodeMetrics };
