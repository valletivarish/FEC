package com.guardianedge.fog.metrics;

import org.junit.jupiter.api.Test;

import static org.junit.jupiter.api.Assertions.assertTrue;

class ProcessResourceSamplerTest {

    @Test
    void cpuUsagePercentIsANonNegativeRealReading() {
        ProcessResourceSampler sampler = new ProcessResourceSampler();
        double cpu = sampler.cpuUsagePercent();
        assertTrue(cpu >= 0.0 && cpu <= 100.0, "expected 0-100 range, got " + cpu);
    }

    @Test
    void usedMemoryIsPositiveAndBoundedByMaxMemory() {
        ProcessResourceSampler sampler = new ProcessResourceSampler();
        long used = sampler.usedMemoryBytes();
        long max = sampler.maxMemoryBytes();

        assertTrue(used > 0, "expected a real positive heap usage reading");
        assertTrue(used <= max, "used memory must not exceed max heap");
    }
}
