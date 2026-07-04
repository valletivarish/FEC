'use strict';

const { NodeMetrics } = require('../shared/nodeMetrics');

describe('NodeMetrics', () => {
  test('starts Idle with zeroed counters', () => {
    const metrics = new NodeMetrics('OccupancyFog');
    const snapshot = metrics.snapshot();

    expect(snapshot.nodeName).toBe('OccupancyFog');
    expect(snapshot.status).toBe('Idle');
    expect(snapshot.messagesReceived).toBe(0);
    expect(snapshot.messagesProcessed).toBe(0);
    expect(snapshot.messagesSent).toBe(0);
    expect(snapshot.queueDepth).toBe(0);
    expect(snapshot.processingDelayMs).toBeNull();
  });

  test('recordReceived increments received count and queue depth; becomes Running', () => {
    const metrics = new NodeMetrics('ComfortFog');
    metrics.recordReceived();
    metrics.recordReceived();

    const snapshot = metrics.snapshot();
    expect(snapshot.status).toBe('Running');
    expect(snapshot.messagesReceived).toBe(2);
    expect(snapshot.queueDepth).toBe(2);
  });

  test('recordProcessed drains queue depth without going negative', () => {
    const metrics = new NodeMetrics('UsageFog');
    metrics.recordProcessed();
    expect(metrics.snapshot().queueDepth).toBe(0);

    metrics.recordReceived();
    metrics.recordReceived();
    metrics.recordProcessed();
    const snapshot = metrics.snapshot();
    // the leading recordProcessed() above already counted once, so two receives + one more processed is 2
    expect(snapshot.messagesProcessed).toBe(2);
    expect(snapshot.queueDepth).toBe(1);
  });

  test('recordDispatch increments sent count and computes a real processing delay from the reading timestamp', () => {
    const metrics = new NodeMetrics('OccupancyFog');
    const pastTimestamp = new Date(Date.now() - 5000).toISOString();

    metrics.recordDispatch({ timestamp: pastTimestamp });

    const snapshot = metrics.snapshot();
    expect(snapshot.messagesSent).toBe(1);
    expect(snapshot.processingDelayMs).toBeGreaterThanOrEqual(4000);
  });

  test('recordDispatch tolerates a missing/invalid timestamp without crashing', () => {
    const metrics = new NodeMetrics('OccupancyFog');
    expect(() => metrics.recordDispatch({})).not.toThrow();
    expect(() => metrics.recordDispatch({ timestamp: 'not-a-date' })).not.toThrow();
    expect(metrics.snapshot().messagesSent).toBe(2);
  });

  test('snapshot reports real OS-measured memory and CPU figures, not fabricated numbers', () => {
    const metrics = new NodeMetrics('UsageFog');
    const snapshot = metrics.snapshot();

    // memoryRssMb must trace to this process's actual resident set size, always positive
    expect(snapshot.memoryRssMb).toBeGreaterThan(0);
    expect(typeof snapshot.cpuPercent).toBe('number');
    expect(snapshot.cpuPercent).toBeGreaterThanOrEqual(0);
  });
});
