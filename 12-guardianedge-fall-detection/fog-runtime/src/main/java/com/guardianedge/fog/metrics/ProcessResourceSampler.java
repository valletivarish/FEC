package com.guardianedge.fog.metrics;

import com.sun.management.OperatingSystemMXBean;
import java.lang.management.ManagementFactory;

/** Reads this JVM process's own CPU and heap usage — the same process all 3 fog nodes run in. */
public class ProcessResourceSampler {

    private final OperatingSystemMXBean osBean =
            (OperatingSystemMXBean) ManagementFactory.getOperatingSystemMXBean();
    private final Runtime runtime = Runtime.getRuntime();

    /** Process CPU load as a 0-100 percentage; -1 from the JDK (not yet available) is surfaced as 0. */
    public double cpuUsagePercent() {
        double load = osBean.getProcessCpuLoad();
        return load < 0 ? 0.0 : load * 100.0;
    }

    public long usedMemoryBytes() {
        return runtime.totalMemory() - runtime.freeMemory();
    }

    public long maxMemoryBytes() {
        return runtime.maxMemory();
    }
}
