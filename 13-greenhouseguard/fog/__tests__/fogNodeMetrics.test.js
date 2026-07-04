const { FogNodeMetrics } = require('../shared/fogNodeMetrics');

describe('FogNodeMetrics', () => {
  test('starts Idle with all counters at zero', () => {
    const metrics = new FogNodeMetrics('ClimateFogNode');
    const snapshot = metrics.snapshot();

    expect(snapshot.name).toBe('ClimateFogNode');
    expect(snapshot.status).toBe('Idle');
    expect(snapshot.messagesReceived).toBe(0);
    expect(snapshot.messagesProcessed).toBe(0);
    expect(snapshot.messagesSent).toBe(0);
    expect(snapshot.queueSize).toBe(0);
    expect(snapshot.processingDelayMs).toBeNull();
  });

  test('recordReceived increments received count and queue depth, flips status to Running', () => {
    const metrics = new FogNodeMetrics('FertigationFogNode');
    metrics.recordReceived();
    metrics.recordReceived();

    const snapshot = metrics.snapshot();
    expect(snapshot.status).toBe('Running');
    expect(snapshot.messagesReceived).toBe(2);
    expect(snapshot.queueSize).toBe(2);
  });

  test('recordProcessed drains queue depth by one and computes a real sensor-to-dispatch delay', () => {
    const metrics = new FogNodeMetrics('EnclosureFogNode');
    metrics.recordReceived();

    const reading = { timestamp: '2026-07-02T10:00:00.000Z' };
    metrics.recordProcessed(reading, '2026-07-02T10:00:00.250Z');

    const snapshot = metrics.snapshot();
    expect(snapshot.messagesProcessed).toBe(1);
    expect(snapshot.queueSize).toBe(0);
    expect(snapshot.processingDelayMs).toBe(250);
  });

  test('queueSize never goes negative when processed exceeds received', () => {
    const metrics = new FogNodeMetrics('ClimateFogNode');
    metrics.recordProcessed({ timestamp: '2026-07-02T10:00:00.000Z' }, '2026-07-02T10:00:00.000Z');

    expect(metrics.snapshot().queueSize).toBe(0);
  });

  test('recordSent accumulates a running dispatch counter, defaulting to +1', () => {
    const metrics = new FogNodeMetrics('ClimateFogNode');
    metrics.recordSent();
    metrics.recordSent(2);

    expect(metrics.snapshot().messagesSent).toBe(3);
  });

  test('snapshot reports real process memory figures, not fabricated ones', () => {
    const metrics = new FogNodeMetrics('ClimateFogNode');
    const snapshot = metrics.snapshot();

    expect(typeof snapshot.memoryRssBytes).toBe('number');
    expect(snapshot.memoryRssBytes).toBeGreaterThan(0);
    expect(typeof snapshot.memoryHeapUsedBytes).toBe('number');
    expect(snapshot.memoryHeapUsedBytes).toBeGreaterThan(0);
  });

  test('cpuPercent is a bounded real measurement derived from process.cpuUsage deltas', () => {
    const metrics = new FogNodeMetrics('ClimateFogNode');
    // burn a small amount of real CPU so the delta is non-trivial
    let total = 0;
    for (let i = 0; i < 2_000_000; i++) total += i;
    const snapshot = metrics.snapshot();

    expect(snapshot.cpuPercent).toBeGreaterThanOrEqual(0);
    expect(snapshot.cpuPercent).toBeLessThanOrEqual(100);
    expect(total).toBeGreaterThan(0);
  });
});
