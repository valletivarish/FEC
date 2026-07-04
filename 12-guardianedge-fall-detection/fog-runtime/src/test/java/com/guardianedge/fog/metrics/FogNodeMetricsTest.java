package com.guardianedge.fog.metrics;

import org.junit.jupiter.api.Test;

import java.time.Instant;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertTrue;

class FogNodeMetricsTest {

    @Test
    void countersStartAtZeroAndIncrementIndependently() {
        FogNodeMetrics metrics = new FogNodeMetrics("VitalsFogNode");

        assertEquals(0, metrics.getReceivedCount());
        assertEquals(0, metrics.getProcessedCount());
        assertEquals(0, metrics.getDispatchedCount());

        metrics.recordReceived();
        metrics.recordReceived();
        metrics.recordProcessed();
        metrics.recordDispatched(2);

        assertEquals(2, metrics.getReceivedCount());
        assertEquals(1, metrics.getProcessedCount());
        assertEquals(2, metrics.getDispatchedCount());
    }

    @Test
    void processingDelayIsComputedFromRealTimestampDifference() {
        FogNodeMetrics metrics = new FogNodeMetrics("FallFogNode");
        String oneSecondAgo = Instant.now().minusSeconds(1).toString();

        metrics.recordProcessingDelay(oneSecondAgo);

        assertTrue(metrics.getLastProcessingDelayMillis() >= 900,
                "expected delay close to 1000ms, got " + metrics.getLastProcessingDelayMillis());
    }

    @Test
    void malformedTimestampLeavesPreviousDelayUnchanged() {
        FogNodeMetrics metrics = new FogNodeMetrics("PresenceFogNode");
        metrics.recordProcessingDelay(Instant.now().minusSeconds(2).toString());
        long recordedDelay = metrics.getLastProcessingDelayMillis();

        metrics.recordProcessingDelay("not-a-timestamp");

        assertEquals(recordedDelay, metrics.getLastProcessingDelayMillis());
    }

    @Test
    void nodeNameIsExposedAsGiven() {
        FogNodeMetrics metrics = new FogNodeMetrics("VitalsFogNode");
        assertEquals("VitalsFogNode", metrics.getNodeName());
    }
}
