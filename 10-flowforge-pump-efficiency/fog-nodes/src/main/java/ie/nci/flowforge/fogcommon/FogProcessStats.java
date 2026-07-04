package ie.nci.flowforge.fogcommon;

import java.lang.management.ManagementFactory;
import java.lang.management.OperatingSystemMXBean;

/**
 * Real JVM process CPU/memory self-report for the fog runtime, shared by every node instance
 * that runs inside this process. {@code ProcessCpuLoad} comes from the JDK's own
 * OperatingSystemMXBean (com.sun.management extension) - not a random number - and heap usage
 * comes from {@link Runtime}, mirroring how the brief asks Node/Python equivalents to self-report.
 */
public final class FogProcessStats {

    private static final OperatingSystemMXBean OS_BEAN = ManagementFactory.getOperatingSystemMXBean();

    private FogProcessStats() {
    }

    /** Percentage (0-100) of a single core this JVM process is consuming, or -1 if unsupported on this JVM. */
    public static double cpuUsagePercent() {
        if (OS_BEAN instanceof com.sun.management.OperatingSystemMXBean sunBean) {
            double load = sunBean.getProcessCpuLoad();
            return load < 0 ? -1.0 : load * 100.0;
        }
        return -1.0;
    }

    public static long usedHeapBytes() {
        Runtime runtime = Runtime.getRuntime();
        return runtime.totalMemory() - runtime.freeMemory();
    }

    public static long maxHeapBytes() {
        return Runtime.getRuntime().maxMemory();
    }
}
