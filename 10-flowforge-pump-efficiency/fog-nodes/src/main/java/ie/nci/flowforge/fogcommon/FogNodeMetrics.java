package ie.nci.flowforge.fogcommon;

import java.time.Instant;
import java.util.concurrent.atomic.AtomicLong;

/**
 * Running counters and processing-delay tracking for one fog node instance. Every number is
 * derived from real traffic through {@link #recordReceived()}/{@link #recordProcessed}/
 * {@link #recordDispatched(int)} - never fabricated - so the dashboard's Fog Node page reflects
 * this node's actual throughput and lag.
 */
public class FogNodeMetrics {

    private final String nodeName;
    private final AtomicLong receivedCount = new AtomicLong();
    private final AtomicLong processedCount = new AtomicLong();
    private final AtomicLong dispatchedCount = new AtomicLong();
    private volatile long lastProcessingDelayMillis;
    private volatile long lastActivityEpochMillis = Instant.now().toEpochMilli();

    public FogNodeMetrics(String nodeName) {
        this.nodeName = nodeName;
    }

    /** Call once per raw sensor reading handed to this node, regardless of whether it triggers an event. */
    public void recordReceived() {
        receivedCount.incrementAndGet();
        lastActivityEpochMillis = Instant.now().toEpochMilli();
    }

    /**
     * Call once the node's real detection logic has finished evaluating a reading. Tracks the gap
     * between the sensor's own reading timestamp and now, so delay reflects true end-to-end lag.
     */
    public void recordProcessed(String readingTimestampIso) {
        processedCount.incrementAndGet();
        lastActivityEpochMillis = Instant.now().toEpochMilli();
        if (readingTimestampIso != null) {
            try {
                long sampledAt = Instant.parse(readingTimestampIso).toEpochMilli();
                lastProcessingDelayMillis = Math.max(0, Instant.now().toEpochMilli() - sampledAt);
            } catch (Exception malformedTimestamp) {
                // a reading with an unparseable timestamp must not break metrics collection
            }
        }
    }

    /** Call once per event this node actually dispatches to the backend (not every reading). */
    public void recordDispatched(int eventCount) {
        dispatchedCount.addAndGet(eventCount);
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
        return lastProcessingDelayMillis;
    }

    /** Idle past this window reads as status "Idle" rather than "Running" on the dashboard. */
    public boolean isActiveWithinMillis(long windowMillis) {
        return Instant.now().toEpochMilli() - lastActivityEpochMillis <= windowMillis;
    }
}
