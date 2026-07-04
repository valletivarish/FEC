const os = require('os');

// Real process self-report: process.cpuUsage() deltas converted to a % of wall-clock time
// elapsed since the previous sample, and process.memoryUsage() read live — no fabricated values.
class ProcessResourceSampler {
  constructor() {
    this.lastCpuUsage = process.cpuUsage();
    this.lastSampleAt = process.hrtime.bigint();
  }

  sample() {
    const cpuUsage = process.cpuUsage(this.lastCpuUsage);
    const now = process.hrtime.bigint();
    const elapsedMs = Number(now - this.lastSampleAt) / 1e6;
    this.lastCpuUsage = process.cpuUsage();
    this.lastSampleAt = now;

    const cpuMs = (cpuUsage.user + cpuUsage.system) / 1000;
    const cores = os.cpus().length || 1;
    const cpuPercent = elapsedMs > 0 ? Math.min(100, (cpuMs / elapsedMs / cores) * 100) : 0;

    const mem = process.memoryUsage();

    return {
      cpuPercent: Number(cpuPercent.toFixed(2)),
      memoryRssBytes: mem.rss,
      memoryHeapUsedBytes: mem.heapUsed,
      memoryHeapTotalBytes: mem.heapTotal,
    };
  }
}

module.exports = { ProcessResourceSampler };
