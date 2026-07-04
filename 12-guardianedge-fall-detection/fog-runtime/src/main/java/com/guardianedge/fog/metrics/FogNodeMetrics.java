package com.guardianedge.fog.metrics;

import java.util.concurrent.atomic.AtomicLong;

/**
 * Self-reported counters and processing-delay measurement for a single fog node type.
 * One instance is shared by the runtime and the node's reading handler.
 */
public class FogNodeMetrics {

    private final String nodeName;
    private final AtomicLong receivedCount = new AtomicLong();
    private final AtomicLong processedCount = new AtomicLong();
    private final AtomicLong dispatchedCount = new AtomicLong();
    private final AtomicLong lastProcessingDelayMillis = new AtomicLong();

    public FogNodeMetrics(String nodeName) {
        this.nodeName = nodeName;
    }

    public void recordReceived() {
        receivedCount.incrementAndGet();
    }

    /** Marks a reading as having actually run through the node's own state-machine logic. */
    public void recordProcessed() {
        processedCount.incrementAndGet();
    }

    public void recordDispatched(int eventCount) {
        dispatchedCount.addAndGet(eventCount);
    }

    /** Delay between the reading's own sensor timestamp and the moment the node finished handling it. */
    public void recordProcessingDelay(String readingTimestamp) {
        try {
            long readingEpochMillis = java.time.Instant.parse(readingTimestamp).toEpochMilli();
            lastProcessingDelayMillis.set(Math.max(0, System.currentTimeMillis() - readingEpochMillis));
        } catch (Exception e) {
            // malformed/missing timestamp: leave the last known delay in place rather than fabricate one
        }
    }

    public String getNodeName() {
        return nodeName;
    }

    public long getReceivedCount() {
        return receivedCount.get();
    }

    public long getProcessedCount() {
        return processedCount.get();
    }

    public long getDispatchedCount() {
        return dispatchedCount.get();
    }

    public long getLastProcessingDelayMillis() {
        return lastProcessingDelayMillis.get();
    }
}
