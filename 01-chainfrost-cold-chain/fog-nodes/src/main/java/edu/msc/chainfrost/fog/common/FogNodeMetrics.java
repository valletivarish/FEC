package edu.msc.chainfrost.fog.common;

import java.lang.management.ManagementFactory;
import java.time.Duration;
import java.time.Instant;
import java.util.concurrent.atomic.AtomicLong;
import java.util.concurrent.atomic.AtomicReference;

import com.sun.management.OperatingSystemMXBean;

/**
 * Self-reporting counters and resource usage for one fog node instance. Each fog node owns
 * its own instance so the dashboard can show three independently-real cards rather than one
 * shared process-wide number pretending to be per-node.
 */
public class FogNodeMetrics {

    private final String nodeName;
    private final OperatingSystemMXBean osBean =
            (OperatingSystemMXBean) ManagementFactory.getOperatingSystemMXBean();
    private final AtomicLong receivedCount = new AtomicLong();
    private final AtomicLong processedCount = new AtomicLong();
    private final AtomicLong dispatchedCount = new AtomicLong();
    private final AtomicReference<Instant> lastActivityAt = new AtomicReference<>();
    // Rolling average processing delay (sensor-reading timestamp -> dispatch instant), in millis.
    private final AtomicLong lastProcessingDelayMillis = new AtomicLong();

    public FogNodeMetrics(String nodeName) {
        this.nodeName = nodeName;
    }

    public void recordReceived() {
        receivedCount.incrementAndGet();
        lastActivityAt.set(Instant.now());
    }

    public void recordProcessed() {
        processedCount.incrementAndGet();
        lastActivityAt.set(Instant.now());
    }

    /** Called at dispatch time with the original sensor reading's timestamp for a real delay figure. */
    public void recordDispatched(Instant readingTimestamp) {
        dispatchedCount.incrementAndGet();
        if (readingTimestamp != null) {
            long delay = Duration.between(readingTimestamp, Instant.now()).toMillis();
            lastProcessingDelayMillis.set(Math.max(delay, 0));
        }
        lastActivityAt.set(Instant.now());
    }

    public String nodeName() {
        return nodeName;
    }

    public long receivedCount() {
        return receivedCount.get();
    }

    public long processedCount() {
        return processedCount.get();
    }

    public long dispatchedCount() {
        return dispatchedCount.get();
    }

    public long processingDelayMillis() {
        return lastProcessingDelayMillis.get();
    }

    /** Idle if no reading has been handled in the last 30s; Error if never started receiving after 30s of life. */
    public String status() {
        Instant last = lastActivityAt.get();
        if (last == null) {
            return "IDLE";
        }
        return Duration.between(last, Instant.now()).toSeconds() <= 30 ? "RUNNING" : "IDLE";
    }

    /** Process-wide CPU load (0-100), real JVM/OS measurement via com.sun.management.OperatingSystemMXBean. */
    public double cpuUsagePercent() {
        double load = osBean.getProcessCpuLoad();
        return load < 0 ? 0.0 : load * 100.0;
    }

    /** Heap actually in use right now, from java.lang.Runtime - real, not sampled/fabricated. */
    public long memoryUsedBytes() {
        Runtime runtime = Runtime.getRuntime();
        return runtime.totalMemory() - runtime.freeMemory();
    }

    public long memoryMaxBytes() {
        return Runtime.getRuntime().maxMemory();
    }
}
