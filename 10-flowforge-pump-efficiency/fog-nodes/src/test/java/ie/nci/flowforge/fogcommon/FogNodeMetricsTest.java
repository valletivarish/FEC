package ie.nci.flowforge.fogcommon;

import org.junit.jupiter.api.Test;

import java.time.Instant;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertTrue;

class FogNodeMetricsTest {

    @Test
    void countersStartAtZeroAndAccumulateAcrossCalls() {
        FogNodeMetrics metrics = new FogNodeMetrics("HealthNode");

        assertEquals(0, metrics.getReceivedCount());
        assertEquals(0, metrics.getProcessedCount());
        assertEquals(0, metrics.getDispatchedCount());

        metrics.recordReceived();
        metrics.recordReceived();
        metrics.recordProcessed(Instant.now().toString());
        metrics.recordDispatched(2);

        assertEquals(2, metrics.getReceivedCount());
        assertEquals(1, metrics.getProcessedCount());
        assertEquals(2, metrics.getDispatchedCount());
    }

    @Test
    void processingDelayReflectsGapBetweenReadingTimestampAndNow() {
        FogNodeMetrics metrics = new FogNodeMetrics("HydraulicsNode");
        String fiveSecondsAgo = Instant.now().minusSeconds(5).toString();

        metrics.recordProcessed(fiveSecondsAgo);

        assertTrue(metrics.getLastProcessingDelayMillis() >= 4900,
                "delay should reflect roughly 5 seconds of real lag, was " + metrics.getLastProcessingDelayMillis());
    }

    @Test
    void malformedTimestampDoesNotCrashAndLeavesPriorDelayIntact() {
        FogNodeMetrics metrics = new FogNodeMetrics("IntegrityNode");
        metrics.recordProcessed(Instant.now().toString());
        long delayAfterGoodTimestamp = metrics.getLastProcessingDelayMillis();

        metrics.recordProcessed("not-a-timestamp");

        assertEquals(delayAfterGoodTimestamp, metrics.getLastProcessingDelayMillis());
    }

    @Test
    void nodeIsActiveImmediatelyAfterActivityAndInactiveOutsideAnElapsedWindow() throws InterruptedException {
        FogNodeMetrics metrics = new FogNodeMetrics("HealthNode");
        metrics.recordReceived();

        assertTrue(metrics.isActiveWithinMillis(30_000));

        Thread.sleep(20);
        assertFalse(metrics.isActiveWithinMillis(5));
    }

    @Test
    void getNodeNameReturnsConstructorValue() {
        FogNodeMetrics metrics = new FogNodeMetrics("HydraulicsNode");
        assertEquals("HydraulicsNode", metrics.getNodeName());
    }
}
