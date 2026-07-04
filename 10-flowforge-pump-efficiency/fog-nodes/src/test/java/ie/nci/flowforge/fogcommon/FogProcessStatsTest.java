package ie.nci.flowforge.fogcommon;

import org.junit.jupiter.api.Test;

import static org.junit.jupiter.api.Assertions.assertTrue;

class FogProcessStatsTest {

    @Test
    void cpuUsagePercentReturnsAPlausibleValueOrTheUnsupportedSentinel() {
        double cpu = FogProcessStats.cpuUsagePercent();
        // -1 is the documented "unsupported on this JVM" sentinel; otherwise must be a real 0-100 reading
        assertTrue(cpu == -1.0 || (cpu >= 0.0 && cpu <= 100.0), "cpu=" + cpu);
    }

    @Test
    void usedHeapBytesIsPositiveAndNeverExceedsMaxHeap() {
        long used = FogProcessStats.usedHeapBytes();
        long max = FogProcessStats.maxHeapBytes();

        assertTrue(used > 0, "a running JVM always has some heap used");
        assertTrue(used <= max, "used=" + used + " max=" + max);
    }
}
