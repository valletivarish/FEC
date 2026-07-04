package com.guardianedge.fog.vitalsfog;

import org.junit.jupiter.api.Test;

import java.util.List;
import java.util.Map;

import static com.guardianedge.fog.vitalsfog.ReadingFixtures.reading;
import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertTrue;

class VitalsFogNodeTest {

    private static final String RESIDENT = "resident-01";
    private static final String TS = "2026-07-02T10:00:00Z";

    @Test
    void sdnnIsComputedOnThe6thEcgrrReadingUsingSampleStdDev() {
        VitalsFogNode node = new VitalsFogNode();
        double[] rrIntervals = {800, 810, 790, 820, 780, 805};

        for (int i = 0; i < 5; i++) {
            List<Map<String, Object>> events = node.onReading(reading(RESIDENT, "ecgrr", rrIntervals[i], TS));
            assertTrue(events.isEmpty(), "ecgrr readings never dispatch directly");
        }
        node.onReading(reading(RESIDENT, "ecgrr", rrIntervals[5], TS));

        // SDNN only surfaces via a vitals_event's sdnnMs field, so trigger one via heartrate WARNING.
        List<Map<String, Object>> events = node.onReading(reading(RESIDENT, "heartrate", 135, TS));
        assertEquals(1, events.size());
        double sdnn = (double) events.get(0).get("sdnnMs");
        assertEquals(14.288690166235206, sdnn, 1e-9);
    }

    @Test
    void sdnnNotComputedBeforeAtLeast5Samples() {
        VitalsFogNode node = new VitalsFogNode();
        node.onReading(reading(RESIDENT, "ecgrr", 800, TS));
        node.onReading(reading(RESIDENT, "ecgrr", 810, TS));

        List<Map<String, Object>> events = node.onReading(reading(RESIDENT, "heartrate", 135, TS));
        assertNull(events.get(0).get("sdnnMs"));
    }

    @Test
    void singleOuterBreachStaysWarningWithoutThreeInnerBreaches() {
        VitalsFogNode node = new VitalsFogNode();
        List<Map<String, Object>> events = node.onReading(reading(RESIDENT, "heartrate", 135, TS));
        assertEquals(1, events.size());
        assertEquals("WARNING", events.get(0).get("newState"));

        // A 2nd breach in a row is still short of the 3-consecutive debounce: no transition dispatched.
        events = node.onReading(reading(RESIDENT, "heartrate", 132, TS));
        assertTrue(events.isEmpty(), "no transition when state is unchanged");
    }

    @Test
    void warningEscalatesToCriticalOnlyAfter3ConsecutiveInnerBreaches() {
        VitalsFogNode node = new VitalsFogNode();
        node.onReading(reading(RESIDENT, "heartrate", 132, TS)); // inner-breach streak #1 -> NORMAL to WARNING
        List<Map<String, Object>> events1 = node.onReading(reading(RESIDENT, "heartrate", 140, TS)); // streak #2
        assertTrue(events1.isEmpty());
        List<Map<String, Object>> events3 = node.onReading(reading(RESIDENT, "heartrate", 140, TS)); // streak #3
        assertEquals(1, events3.size());
        assertEquals("WARNING", events3.get(0).get("previousState"));
        assertEquals("CRITICAL", events3.get(0).get("newState"));
    }

    @Test
    void recoveryOnlyHappensCrossingBackOverOuterSafeThreshold() {
        VitalsFogNode node = new VitalsFogNode();
        node.onReading(reading(RESIDENT, "heartrate", 140, TS));
        node.onReading(reading(RESIDENT, "heartrate", 140, TS));
        node.onReading(reading(RESIDENT, "heartrate", 140, TS)); // now CRITICAL

        // Still outside outer-safe range (130 boundary): must remain CRITICAL, not silently recover.
        List<Map<String, Object>> stillOutside = node.onReading(reading(RESIDENT, "heartrate", 131, TS));
        assertTrue(stillOutside.isEmpty());

        List<Map<String, Object>> recovered = node.onReading(reading(RESIDENT, "heartrate", 129, TS));
        assertEquals(1, recovered.size());
        assertEquals("CRITICAL", recovered.get(0).get("previousState"));
        assertEquals("NORMAL", recovered.get(0).get("newState"));
    }

    @Test
    void spo2Below90For3ConsecutiveReadingsEscalatesDirectlyToCritical() {
        VitalsFogNode node = new VitalsFogNode();
        List<Map<String, Object>> e1 = node.onReading(reading(RESIDENT, "spo2", 88, TS));
        assertEquals("WARNING", e1.get(0).get("newState"));
        node.onReading(reading(RESIDENT, "spo2", 88, TS));
        List<Map<String, Object>> e3 = node.onReading(reading(RESIDENT, "spo2", 88, TS));
        assertEquals("CRITICAL", e3.get(0).get("newState"));
    }

    @Test
    void resprateEntersWarningOnOuterBreach() {
        VitalsFogNode node = new VitalsFogNode();
        List<Map<String, Object>> warn = node.onReading(reading(RESIDENT, "resprate", 30, TS));
        assertEquals("WARNING", warn.get(0).get("newState"));
    }

    @Test
    void skintempEscalatesToCriticalAfter3ConsecutiveInnerBreaches() {
        VitalsFogNode node = new VitalsFogNode();
        // 39.0 breaches both the outer (38.5) and inner (38.0) skintemp thresholds immediately.
        List<Map<String, Object>> e1 = node.onReading(reading(RESIDENT, "skintemp", 39.0, TS));
        assertEquals("WARNING", e1.get(0).get("newState"));
        node.onReading(reading(RESIDENT, "skintemp", 39.0, TS));
        List<Map<String, Object>> e3 = node.onReading(reading(RESIDENT, "skintemp", 39.0, TS));
        assertEquals("CRITICAL", e3.get(0).get("newState"));
    }

    @Test
    void compoundingForcesCriticalWhenSdnnLowAndAnotherVitalAlreadyFlagged() {
        VitalsFogNode node = new VitalsFogNode();
        // Drive SDNN low: near-identical RR intervals produce a small sample stddev.
        double[] lowVariabilityRr = {800, 801, 799, 800, 801, 800};
        for (double rr : lowVariabilityRr) {
            node.onReading(reading(RESIDENT, "ecgrr", rr, TS));
        }

        // First vital enters WARNING.
        node.onReading(reading(RESIDENT, "spo2", 88, TS));

        // Second vital's own hysteresis alone would only justify WARNING (single outer breach).
        List<Map<String, Object>> events = node.onReading(reading(RESIDENT, "heartrate", 135, TS));
        assertEquals(1, events.size());
        assertEquals("CRITICAL", events.get(0).get("newState"),
                "low SDNN plus an already-WARNING vital should force straight to CRITICAL");
    }

    @Test
    void compoundingDoesNotApplyWhenSdnnIsNormal() {
        VitalsFogNode node = new VitalsFogNode();
        // Wide swings in RR intervals produce a high (normal) SDNN.
        double[] highVariabilityRr = {600, 1000, 650, 950, 700, 900};
        for (double rr : highVariabilityRr) {
            node.onReading(reading(RESIDENT, "ecgrr", rr, TS));
        }

        node.onReading(reading(RESIDENT, "spo2", 88, TS));
        List<Map<String, Object>> events = node.onReading(reading(RESIDENT, "heartrate", 135, TS));
        assertEquals("WARNING", events.get(0).get("newState"));
    }

    @Test
    void compoundingDoesNotApplyWhenNoOtherVitalIsFlagged() {
        VitalsFogNode node = new VitalsFogNode();
        double[] lowVariabilityRr = {800, 801, 799, 800, 801, 800};
        for (double rr : lowVariabilityRr) {
            node.onReading(reading(RESIDENT, "ecgrr", rr, TS));
        }

        List<Map<String, Object>> events = node.onReading(reading(RESIDENT, "heartrate", 135, TS));
        assertEquals("WARNING", events.get(0).get("newState"));
    }

    @Test
    void noDispatchWhileStateUnchanged() {
        VitalsFogNode node = new VitalsFogNode();
        node.onReading(reading(RESIDENT, "heartrate", 100, TS));
        List<Map<String, Object>> events = node.onReading(reading(RESIDENT, "heartrate", 102, TS));
        assertTrue(events.isEmpty());
    }
}
