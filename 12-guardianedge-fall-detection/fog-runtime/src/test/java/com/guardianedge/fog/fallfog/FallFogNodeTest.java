package com.guardianedge.fog.fallfog;

import org.junit.jupiter.api.Test;

import java.util.HashMap;
import java.util.List;
import java.util.Map;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertTrue;

class FallFogNodeTest {

    private static final String RESIDENT = "resident-02";
    private static final String TS = "2026-07-02T10:00:00Z";

    private Map<String, Object> accel(double magnitude) {
        return reading("accelerometer", magnitude);
    }

    private Map<String, Object> gyro(double magnitude) {
        return reading("gyroscope", magnitude);
    }

    private Map<String, Object> reading(String metric, double value) {
        Map<String, Object> r = new HashMap<>();
        r.put("residentId", RESIDENT);
        r.put("metric", metric);
        r.put("value", value);
        r.put("unit", "n/a");
        r.put("timestamp", TS);
        return r;
    }

    private void driveIntoFreeFall(FallFogNode node) {
        node.onReading(accel(1.0));
        node.onReading(accel(1.0));
        node.onReading(accel(1.0));
    }

    private void driveIntoStillnessConfirm(FallFogNode node) {
        driveIntoFreeFall(node);
        node.onReading(accel(120.0)); // impact spike
    }

    @Test
    void threeConsecutiveLowAccelReadingsEnterFreeFall() {
        FallFogNode node = new FallFogNode();
        assertTrue(node.onReading(accel(1.0)).isEmpty());
        assertTrue(node.onReading(accel(1.0)).isEmpty());
        assertTrue(node.onReading(accel(1.0)).isEmpty());
        // No public state getter; confirmed indirectly via the impact->stillness->confirm path below.
    }

    @Test
    void nonConsecutiveLowReadingsDoNotAccumulateTowardFreeFall() {
        FallFogNode node = new FallFogNode();
        node.onReading(accel(1.0));
        node.onReading(accel(1.0));
        node.onReading(accel(10.0)); // breaks the streak
        node.onReading(accel(1.0));
        // Only 1 consecutive low reading now; an impact spike must NOT confirm a fall.
        List<Map<String, Object>> events = node.onReading(accel(120.0));
        assertTrue(events.isEmpty());
    }

    @Test
    void freeFallRevertsToMonitoringIfNoImpactWithinNext5Readings() {
        FallFogNode node = new FallFogNode();
        driveIntoFreeFall(node);
        for (int i = 0; i < 5; i++) {
            node.onReading(accel(9.8)); // normal gravity, no spike
        }
        // Having reverted, a fresh impact spike alone (without a new 3-consecutive free-fall) must not confirm.
        List<Map<String, Object>> events = node.onReading(accel(120.0));
        assertTrue(events.isEmpty());
    }

    @Test
    void impactWithinWindowEntersStillnessConfirmImmediately() {
        FallFogNode node = new FallFogNode();
        driveIntoFreeFall(node);
        node.onReading(accel(50.0)); // 1 of 5 window readings, no spike yet
        List<Map<String, Object>> events = node.onReading(accel(150.0)); // spike within window
        assertTrue(events.isEmpty(), "entering STILLNESS_CONFIRM itself dispatches nothing");
    }

    @Test
    void largeSingleGyroReadingDuringStillnessConfirmRevertsToMonitoring() {
        FallFogNode node = new FallFogNode();
        driveIntoStillnessConfirm(node);
        node.onReading(gyro(10.0));
        List<Map<String, Object>> events = node.onReading(gyro(60.0)); // clear movement, above 50
        assertTrue(events.isEmpty());

        // Confirm the revert really happened: a fresh genuine fall sequence must still be detectable.
        driveIntoStillnessConfirm(node);
        for (int i = 0; i < 4; i++) {
            node.onReading(gyro(1.0));
        }
        List<Map<String, Object>> confirmed = node.onReading(gyro(1.0));
        assertEquals(1, confirmed.size());
        assertEquals("FALL_CONFIRMED", confirmed.get(0).get("state"));
    }

    @Test
    void lowStddevGyroWindowConfirmsFall() {
        FallFogNode node = new FallFogNode();
        driveIntoStillnessConfirm(node);
        node.onReading(gyro(1.0));
        node.onReading(gyro(1.2));
        node.onReading(gyro(0.8));
        node.onReading(gyro(1.1));
        List<Map<String, Object>> events = node.onReading(gyro(0.9));

        assertEquals(1, events.size());
        Map<String, Object> event = events.get(0);
        assertEquals("fall_event", event.get("type"));
        assertEquals(RESIDENT, event.get("residentId"));
        assertEquals("FALL_CONFIRMED", event.get("state"));
        assertEquals(120.0, (double) event.get("accelMagnitude"), 1e-9);
    }

    @Test
    void mediumStddevGyroWindowKeepsCollectingWithoutRevertingOrConfirming() {
        FallFogNode node = new FallFogNode();
        driveIntoStillnessConfirm(node);
        // Population stddev of this window is ~7.35 (>= 5.0 threshold), and no single reading exceeds 50.
        node.onReading(gyro(0.0));
        node.onReading(gyro(15.0));
        node.onReading(gyro(0.0));
        node.onReading(gyro(15.0));
        List<Map<String, Object>> events = node.onReading(gyro(0.0));
        assertTrue(events.isEmpty(), "ambiguous stddev neither confirms nor reverts");

        // Still in STILLNESS_CONFIRM: a fresh low-stddev window should now confirm the fall.
        node.onReading(gyro(1.0));
        node.onReading(gyro(1.0));
        node.onReading(gyro(1.0));
        node.onReading(gyro(1.0));
        List<Map<String, Object>> confirmed = node.onReading(gyro(1.0));
        assertEquals(1, confirmed.size());
        assertEquals("FALL_CONFIRMED", confirmed.get(0).get("state"));
    }

    @Test
    void fallConfirmedIsTerminalUntilExplicitReset() {
        FallFogNode node = new FallFogNode();
        driveIntoStillnessConfirm(node);
        for (int i = 0; i < 4; i++) {
            node.onReading(gyro(1.0));
        }
        List<Map<String, Object>> confirmed = node.onReading(gyro(1.0));
        assertEquals(1, confirmed.size());

        // Further readings, even another full fall sequence, must not re-dispatch.
        driveIntoFreeFall(node);
        node.onReading(accel(150.0));
        for (int i = 0; i < 5; i++) {
            assertTrue(node.onReading(gyro(1.0)).isEmpty());
        }

        node.resetResident(RESIDENT);
        driveIntoStillnessConfirm(node);
        for (int i = 0; i < 4; i++) {
            node.onReading(gyro(1.0));
        }
        List<Map<String, Object>> afterReset = node.onReading(gyro(1.0));
        assertEquals(1, afterReset.size(), "a genuine fall must be detectable again after reset");
    }

    @Test
    void exactlyOneFallConfirmedDispatchPerGenuineSequence() {
        FallFogNode node = new FallFogNode();
        driveIntoStillnessConfirm(node);
        int dispatchCount = 0;
        for (int i = 0; i < 4; i++) {
            dispatchCount += node.onReading(gyro(1.0)).size();
        }
        dispatchCount += node.onReading(gyro(1.0)).size();
        assertEquals(1, dispatchCount);
    }
}
