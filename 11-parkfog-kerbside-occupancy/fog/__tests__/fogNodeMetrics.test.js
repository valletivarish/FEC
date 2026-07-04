const { FogNodeMetrics } = require('../shared/fogNodeMetrics');

describe('FogNodeMetrics', () => {
  test('starts idle with all counters at zero', () => {
    const metrics = new FogNodeMetrics('bay-sensing-fog');
    const snapshot = metrics.snapshot();

    expect(snapshot.nodeName).toBe('bay-sensing-fog');
    expect(snapshot.status).toBe('Idle');
    expect(snapshot.receivedCount).toBe(0);
    expect(snapshot.processedCount).toBe(0);
    expect(snapshot.sentCount).toBe(0);
    expect(snapshot.queueSize).toBe(0);
    expect(snapshot.averageProcessingDelayMs).toBe(0);
  });

  test('flips to Running once a reading has been received', () => {
    const metrics = new FogNodeMetrics('bay-sensing-fog');
    metrics.recordReceived();
    expect(metrics.snapshot().status).toBe('Running');
  });

  test('queue grows on receive and shrinks on process, reflecting real in-flight backlog', () => {
    const metrics = new FogNodeMetrics('bay-sensing-fog');
    metrics.recordReceived();
    metrics.recordReceived();
    expect(metrics.queueSize).toBe(2);

    metrics.recordProcessed({ timestamp: new Date().toISOString() });
    expect(metrics.queueSize).toBe(1);
    expect(metrics.processedCount).toBe(1);
  });

  test('computes real processing delay as now minus the reading timestamp', () => {
    const metrics = new FogNodeMetrics('bay-sensing-fog');
    const pastTimestamp = new Date(Date.now() - 500).toISOString();

    metrics.recordReceived();
    metrics.recordProcessed({ timestamp: pastTimestamp });

    expect(metrics.averageProcessingDelayMs).toBeGreaterThanOrEqual(400);
    expect(metrics.averageProcessingDelayMs).toBeLessThan(5000);
  });

  test('ignores readings with no usable timestamp when computing delay', () => {
    const metrics = new FogNodeMetrics('bay-sensing-fog');
    metrics.recordReceived();
    metrics.recordProcessed({});
    expect(metrics.averageProcessingDelayMs).toBe(0);
  });

  test('sentCount accumulates only on recordSent, independent of received/processed', () => {
    const metrics = new FogNodeMetrics('bay-sensing-fog');
    metrics.recordReceived();
    metrics.recordProcessed({ timestamp: new Date().toISOString() });
    expect(metrics.snapshot().sentCount).toBe(0);

    metrics.recordSent();
    expect(metrics.snapshot().sentCount).toBe(1);
  });

  test('cpuPercent and memory figures are real numbers, not fabricated placeholders', () => {
    const metrics = new FogNodeMetrics('bay-sensing-fog');
    // burn a little CPU so usage since construction is non-negative and measurable
    let acc = 0;
    for (let i = 0; i < 1e6; i += 1) acc += i;
    const snapshot = metrics.snapshot();

    expect(typeof snapshot.cpuPercent).toBe('number');
    expect(snapshot.cpuPercent).toBeGreaterThanOrEqual(0);
    expect(snapshot.memoryUsedMb).toBeGreaterThan(0);
    expect(snapshot.heapUsedMb).toBeGreaterThan(0);
    expect(acc).toBeGreaterThan(0);
  });

  test('keeps only the most recent 20 processing delays in its rolling window', () => {
    const metrics = new FogNodeMetrics('bay-sensing-fog');
    for (let i = 0; i < 25; i += 1) {
      metrics.recordReceived();
      metrics.recordProcessed({ timestamp: new Date().toISOString() });
    }
    expect(metrics.processingDelaysMs.length).toBe(20);
  });
});
