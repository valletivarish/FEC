package ie.nci.flowforge.fn3integrity;

import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;

import java.util.HashMap;
import java.util.List;
import java.util.Map;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertTrue;

class IntegrityNodeTest {

    private static final String PUMP_ID = "pump-03";

    private IntegrityNode integrityNode;

    @BeforeEach
    void setUp() {
        integrityNode = new IntegrityNode();
    }

    private Map<String, Object> sealLeakReading(double value) {
        Map<String, Object> r = new HashMap<>();
        r.put("pumpId", PUMP_ID);
        r.put("metric", "seal-leak");
        r.put("value", value);
        r.put("timestamp", "2026-01-01T00:00:00Z");
        return r;
    }

    private Map<String, Object> turbidityReading(double value) {
        Map<String, Object> r = new HashMap<>();
        r.put("pumpId", PUMP_ID);
        r.put("metric", "turbidity");
        r.put("value", value);
        r.put("timestamp", "2026-01-01T00:00:00Z");
        return r;
    }

    @Test
    void startsInLeakOkAndStaysThereBelowUpperThreshold() {
        List<Map<String, Object>> events = integrityNode.onReading(sealLeakReading(10.0));
        assertTrue(events.isEmpty(), "no transition, no dispatch");
    }

    @Test
    void transitionsToLeakWatchAboveUpperThreshold() {
        List<Map<String, Object>> events = integrityNode.onReading(sealLeakReading(35.0));

        assertEquals(1, events.size());
        assertEquals("LEAK_WATCH", events.get(0).get("state"));
    }

    @Test
    void hysteresisBandPreventsFlappingBetweenThresholds() {
        integrityNode.onReading(sealLeakReading(35.0)); // -> LEAK_WATCH

        // readings between 15 and 30 must NOT flip state back to LEAK_OK while in LEAK_WATCH
        List<Map<String, Object>> mid1 = integrityNode.onReading(sealLeakReading(25.0));
        List<Map<String, Object>> mid2 = integrityNode.onReading(sealLeakReading(20.0));
        List<Map<String, Object>> mid3 = integrityNode.onReading(sealLeakReading(16.0));

        assertTrue(mid1.isEmpty(), "25 mL/min in LEAK_WATCH stays in LEAK_WATCH");
        assertTrue(mid2.isEmpty(), "20 mL/min in LEAK_WATCH stays in LEAK_WATCH");
        assertTrue(mid3.isEmpty(), "16 mL/min in LEAK_WATCH stays in LEAK_WATCH");
    }

    @Test
    void hysteresisBandKeepsLeakOkStableForMidRangeReadings() {
        // readings between 15 and 30 while starting in LEAK_OK must not transition to LEAK_WATCH
        List<Map<String, Object>> mid1 = integrityNode.onReading(sealLeakReading(20.0));
        List<Map<String, Object>> mid2 = integrityNode.onReading(sealLeakReading(28.0));

        assertTrue(mid1.isEmpty(), "20 mL/min in LEAK_OK stays in LEAK_OK");
        assertTrue(mid2.isEmpty(), "28 mL/min in LEAK_OK stays in LEAK_OK");
    }

    @Test
    void transitionsBackToLeakOkBelowLowerThreshold() {
        integrityNode.onReading(sealLeakReading(35.0)); // -> LEAK_WATCH

        List<Map<String, Object>> events = integrityNode.onReading(sealLeakReading(10.0));

        assertEquals(1, events.size());
        assertEquals("LEAK_OK", events.get(0).get("state"));
    }

    @Test
    void leakOkCannotJumpDirectlyToLeakCriticalEvenWithSteepTrend() {
        // 6+ samples with a steep rising slope, but all comfortably inside LEAK_OK range (never crosses 30)
        double[] steepButLowValues = {5.0, 7.0, 9.0, 11.0, 13.0, 15.0};

        List<Map<String, Object>> lastEvents = List.of();
        for (double v : steepButLowValues) {
            lastEvents = integrityNode.onReading(sealLeakReading(v));
        }

        // none of these readings crosses the upper threshold, so state must remain LEAK_OK throughout
        for (double v : steepButLowValues) {
            List<Map<String, Object>> events = integrityNode.onReading(sealLeakReading(v));
            assertTrue(events.isEmpty() || !"LEAK_CRITICAL".equals(events.get(0).get("state")),
                    "LEAK_OK must never escalate directly to LEAK_CRITICAL");
        }
    }

    @Test
    void watchEscalatesToCriticalOnSteepSustainedRiseTrend() {
        integrityNode.onReading(sealLeakReading(35.0)); // -> LEAK_WATCH

        // rising trend, all within/above the watch band; the transition may fire as soon as
        // the window (>= 6 samples) crosses the 0.4 slope threshold, not necessarily on the last sample
        double[] risingTrend = {32.0, 33.0, 34.0, 36.0, 38.0, 40.0};
        Map<String, Object> criticalEvent = null;
        for (double v : risingTrend) {
            List<Map<String, Object>> events = integrityNode.onReading(sealLeakReading(v));
            if (!events.isEmpty() && "LEAK_CRITICAL".equals(events.get(0).get("state"))) {
                criticalEvent = events.get(0);
                break;
            }
        }

        assertTrue(criticalEvent != null, "a steep sustained rise while in LEAK_WATCH must escalate to LEAK_CRITICAL");
        double slope = (double) criticalEvent.get("trendSlope");
        assertTrue(slope > 0.4, "escalation must be backed by a slope above the 0.4 threshold");
    }

    @Test
    void criticalReturnsToLeakOkWhenLeakClearsBelowLowerThreshold() {
        integrityNode.onReading(sealLeakReading(35.0));
        double[] risingTrend = {32.0, 33.0, 34.0, 36.0, 38.0, 40.0};
        for (double v : risingTrend) {
            integrityNode.onReading(sealLeakReading(v));
        }
        // now in LEAK_CRITICAL

        List<Map<String, Object>> events = integrityNode.onReading(sealLeakReading(10.0));

        assertEquals(1, events.size());
        assertEquals("LEAK_OK", events.get(0).get("state"));
    }

    @Test
    void dispatchesOnlyOnTransitionNeverOnUnchangedState() {
        integrityNode.onReading(sealLeakReading(35.0)); // -> LEAK_WATCH, dispatches

        List<Map<String, Object>> repeat1 = integrityNode.onReading(sealLeakReading(36.0));
        List<Map<String, Object>> repeat2 = integrityNode.onReading(sealLeakReading(37.0));

        assertTrue(repeat1.isEmpty());
        assertTrue(repeat2.isEmpty());
    }

    @Test
    void turbidityReadingAloneNeverDispatches() {
        List<Map<String, Object>> events = integrityNode.onReading(turbidityReading(38.0));

        assertTrue(events.isEmpty(), "turbidity only updates internal state, seal-leak drives dispatch");
    }

    @Test
    void turbidityIsAttachedToTransitionEventWhenAvailable() {
        integrityNode.onReading(turbidityReading(5.0));

        List<Map<String, Object>> events = integrityNode.onReading(sealLeakReading(35.0));

        assertEquals(1, events.size());
        assertEquals(5.0, (double) events.get(0).get("turbidity"));
    }

    @Test
    void transitionEventHasNullTurbidityWhenNoneReceivedYet() {
        List<Map<String, Object>> events = integrityNode.onReading(sealLeakReading(35.0));

        assertEquals(1, events.size());
        assertEquals(null, events.get(0).get("turbidity"));
    }

    @Test
    void highTurbidityEscalatesWatchToCriticalWithoutSteepTrend() {
        integrityNode.onReading(sealLeakReading(35.0)); // -> LEAK_WATCH

        integrityNode.onReading(turbidityReading(30.0)); // above contamination threshold
        List<Map<String, Object>> events = integrityNode.onReading(sealLeakReading(35.0)); // flat, no trend escalation

        assertEquals(1, events.size());
        assertEquals("LEAK_CRITICAL", events.get(0).get("state"));
        assertEquals(30.0, (double) events.get(0).get("turbidity"));
    }

    @Test
    void lowTurbidityDoesNotEscalateWatchWithoutSteepTrend() {
        integrityNode.onReading(sealLeakReading(35.0)); // -> LEAK_WATCH

        integrityNode.onReading(turbidityReading(3.0)); // clean fluid, below contamination threshold
        List<Map<String, Object>> events = integrityNode.onReading(sealLeakReading(35.0));

        assertTrue(events.isEmpty(), "clean turbidity must not corroborate an escalation");
    }

    @Test
    void highTurbidityAloneCannotEscalateLeakOk() {
        integrityNode.onReading(turbidityReading(30.0));

        List<Map<String, Object>> events = integrityNode.onReading(sealLeakReading(10.0));

        assertTrue(events.isEmpty(), "turbidity is only corroborating, never a leak signal on its own");
    }
}
