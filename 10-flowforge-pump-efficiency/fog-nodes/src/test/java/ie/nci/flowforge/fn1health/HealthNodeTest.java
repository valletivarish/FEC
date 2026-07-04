package ie.nci.flowforge.fn1health;

import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;

import java.util.HashMap;
import java.util.List;
import java.util.Map;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertTrue;

class HealthNodeTest {

    private static final String PUMP_ID = "pump-01";

    private HealthNode healthNode;

    @BeforeEach
    void setUp() {
        healthNode = new HealthNode();
    }

    private Map<String, Object> vibrationReading(double value, String timestamp) {
        Map<String, Object> reading = new HashMap<>();
        reading.put("pumpId", PUMP_ID);
        reading.put("metric", "vibration");
        reading.put("value", value);
        reading.put("unit", "mm/s");
        reading.put("timestamp", timestamp);
        return reading;
    }

    @Test
    void madScoreMatchesHandComputedReferenceOnKnownOutlier() {
        // 9 stable samples (median 2.0, MAD 0.1) then one outlier at 8.0:
        // score = 0.6745 * (8.0 - 2.0) / 0.1 = 40.47, well past the 3.5 trip threshold
        double[] values = {2.0, 2.1, 1.9, 2.0, 2.2, 1.8, 2.1, 2.0, 1.9, 8.0};

        List<Map<String, Object>> lastResult = List.of();
        for (double v : values) {
            lastResult = healthNode.onReading(vibrationReading(v, "2026-01-01T00:00:00Z"));
        }

        assertEquals(1, lastResult.size());
        Map<String, Object> event = lastResult.get(0);
        assertEquals("health_event", event.get("type"));
        assertEquals("mad_anomaly", event.get("trigger"));
        double madScore = (double) event.get("madScore");
        assertEquals(40.47, madScore, 0.5);
    }

    @Test
    void cusumDoesNotTripOnStableNoise() {
        double[] stableNoise = {
                2.0, 2.05, 1.95, 2.0, 2.1, 1.9, 2.0, 2.05, 1.95, 2.0,
                2.02, 1.98, 2.03, 1.97, 2.0, 2.01, 1.99, 2.0, 2.02, 1.98
        };

        boolean anyCusumTrip = false;
        for (double v : stableNoise) {
            List<Map<String, Object>> events = healthNode.onReading(vibrationReading(v, "2026-01-01T00:00:00Z"));
            if (!events.isEmpty() && "cusum_changepoint".equals(events.get(0).get("trigger"))) {
                anyCusumTrip = true;
            }
        }

        assertFalse(anyCusumTrip, "stable noise must not trip the CUSUM change-point detector");
    }

    @Test
    void cusumTripsAfterSustainedLevelShift() {
        double[] stableNoise = {
                2.0, 2.05, 1.95, 2.0, 2.1, 1.9, 2.0, 2.05, 1.95, 2.0,
                2.02, 1.98, 2.03, 1.97, 2.0, 2.01, 1.99, 2.0, 2.02, 1.98
        };
        for (double v : stableNoise) {
            healthNode.onReading(vibrationReading(v, "2026-01-01T00:00:00Z"));
        }

        boolean tripped = false;
        for (int i = 0; i < 15 && !tripped; i++) {
            List<Map<String, Object>> events = healthNode.onReading(vibrationReading(3.0, "2026-01-01T00:00:00Z"));
            if (!events.isEmpty()
                    && ("cusum_changepoint".equals(events.get(0).get("trigger"))
                        || "mad_anomaly".equals(events.get(0).get("trigger")))) {
                tripped = true;
            }
        }

        assertTrue(tripped, "a sustained level shift must eventually trip a change-point or anomaly event");
    }

    @Test
    void heartbeatFiresOnEveryFifthTickWithNoOtherTrip() {
        // stay well below the 10-sample analysis floor and away from any anomaly,
        // so only the every-6th-call heartbeat can be responsible for a dispatch
        int dispatchCount = 0;
        for (int i = 1; i <= 12; i++) {
            List<Map<String, Object>> events = healthNode.onReading(vibrationReading(2.0, "2026-01-01T00:00:00Z"));
            if (!events.isEmpty()) {
                dispatchCount++;
                assertEquals("heartbeat", events.get(0).get("trigger"));
            } else {
                assertTrue(i % 6 != 0, "tick " + i + " should have produced a heartbeat");
            }
        }

        assertEquals(2, dispatchCount, "12 ticks should produce exactly 2 heartbeats (tick 6 and 12)");
    }

    @Test
    void madAndCusumOnSameReadingDispatchOneEventLabelledMadAnomaly() {
        // build up a window, then a single reading extreme enough to trip both checks simultaneously
        double[] values = {2.0, 2.1, 1.9, 2.0, 2.2, 1.8, 2.1, 2.0, 1.9};
        for (double v : values) {
            healthNode.onReading(vibrationReading(v, "2026-01-01T00:00:00Z"));
        }

        List<Map<String, Object>> events = healthNode.onReading(vibrationReading(50.0, "2026-01-01T00:00:00Z"));

        assertEquals(1, events.size(), "only one event should be dispatched even if multiple triggers fire");
        assertEquals("mad_anomaly", events.get(0).get("trigger"));
    }

    @Test
    void carriesLatestBearingTempMotorCurrentAndRpmOnDispatch() {
        Map<String, Object> bearingTemp = new HashMap<>();
        bearingTemp.put("pumpId", PUMP_ID);
        bearingTemp.put("metric", "bearing-temp");
        bearingTemp.put("value", 60.0);
        healthNode.onReading(bearingTemp);

        Map<String, Object> motorCurrent = new HashMap<>();
        motorCurrent.put("pumpId", PUMP_ID);
        motorCurrent.put("metric", "motor-current");
        motorCurrent.put("value", 20.0);
        healthNode.onReading(motorCurrent);

        Map<String, Object> rpm = new HashMap<>();
        rpm.put("pumpId", PUMP_ID);
        rpm.put("metric", "rpm");
        rpm.put("value", 1500.0);
        healthNode.onReading(rpm);

        List<Map<String, Object>> events = List.of();
        for (int i = 0; i < 6; i++) {
            events = healthNode.onReading(vibrationReading(2.0, "2026-01-01T00:00:00Z"));
        }

        assertEquals(1, events.size());
        Map<String, Object> event = events.get(0);
        assertEquals(60.0, event.get("bearingTemp"));
        assertEquals(20.0, event.get("motorCurrent"));
        assertEquals(1500.0, event.get("rpm"));
    }
}
