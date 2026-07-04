package edu.msc.floodwatch.fog.common;

import com.sun.management.OperatingSystemMXBean;

import java.lang.management.ManagementFactory;
import java.time.Duration;
import java.time.Instant;
import java.util.Map;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.atomic.AtomicLong;

/**
 * Self-reported operating metrics for one fog node type (Hydro/Quality/Meteo), shared by
 * every per-reach instance of that type since they run in the same JVM/process. CPU and
 * memory are read from the JVM's own OperatingSystemMXBean/Runtime rather than fabricated,
 * matching what a real process-level self-report would expose; counters/delay/queue depth
 * are incremented by the actual fog runtime loop as readings flow through it.
 */
public class FogNodeRuntimeMetrics {

    private static final OperatingSystemMXBean OS_BEAN =
            (OperatingSystemMXBean) ManagementFactory.getOperatingSystemMXBean();

    private final String nodeName;
    private final AtomicLong messagesReceived = new AtomicLong();
    private final AtomicLong messagesProcessed = new AtomicLong();
    private final AtomicLong messagesSent = new AtomicLong();
    private final AtomicLong queueDepth = new AtomicLong();
    private final AtomicLong lastProcessingDelayMillis = new AtomicLong();
    private final Map<String, Instant> lastActivityByReach = new ConcurrentHashMap<>();

    public FogNodeRuntimeMetrics(String nodeName) {
        this.nodeName = nodeName;
    }

    /** Called the instant a reading is pulled off the MQTT callback for this node type. */
    public void onReadingReceived(String reachId) {
        messagesReceived.incrementAndGet();
        queueDepth.incrementAndGet();
        lastActivityByReach.put(reachId, Instant.now());
    }

    /**
     * Called once the node's real classification/aggregation logic has finished running on
     * that reading, whether or not it produced a dispatchable event.
     */
    public void onReadingProcessed() {
        messagesProcessed.incrementAndGet();
        queueDepth.decrementAndGet();
    }

    /**
     * Called once an event derived from a reading is handed to the dispatcher. Processing
     * delay is measured against the reading's own sensor-side timestamp, so it reflects real
     * sensor-to-cloud latency, not just in-JVM compute time.
     */
    public void onEventDispatched(Instant sensorReadingTimestamp) {
        messagesSent.incrementAndGet();
        if (sensorReadingTimestamp != null) {
            long delayMillis = Duration.between(sensorReadingTimestamp, Instant.now()).toMillis();
            lastProcessingDelayMillis.set(Math.max(0, delayMillis));
        }
    }

    public String nodeName() {
        return nodeName;
    }

    public long messagesReceived() {
        return messagesReceived.get();
    }

    public long messagesProcessed() {
        return messagesProcessed.get();
    }

    public long messagesSent() {
        return messagesSent.get();
    }

    public long queueDepth() {
        return Math.max(0, queueDepth.get());
    }

    public long lastProcessingDelayMillis() {
        return lastProcessingDelayMillis.get();
    }

    /** Idle if nothing has arrived for this node type in the last 30s; running otherwise. */
    public String status() {
        if (messagesReceived.get() == 0) {
            return "Idle";
        }
        Instant mostRecent = lastActivityByReach.values().stream().max(Instant::compareTo).orElse(null);
        if (mostRecent == null || Duration.between(mostRecent, Instant.now()).toSeconds() > 30) {
            return "Idle";
        }
        return "Running";
    }

    /** Process-wide CPU load (0.0-1.0), shared across all node types since they're one JVM. */
    public static double processCpuLoad() {
        double load = OS_BEAN.getProcessCpuLoad();
        return load < 0 ? 0.0 : load;
    }

    /** Process-wide heap usage in MB. */
    public static long usedMemoryMb() {
        Runtime runtime = Runtime.getRuntime();
        return (runtime.totalMemory() - runtime.freeMemory()) / (1024 * 1024);
    }
}
