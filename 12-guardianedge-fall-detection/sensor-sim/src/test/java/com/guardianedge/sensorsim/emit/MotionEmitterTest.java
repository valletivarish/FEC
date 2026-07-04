package com.guardianedge.sensorsim.emit;

import static org.junit.jupiter.api.Assertions.assertTrue;

import com.guardianedge.sensorsim.model.SensorReading;
import org.junit.jupiter.api.Test;

class MotionEmitterTest {

    private static final int ITERATIONS = 20000;

    @Test
    void accelerometerStaysWithinBaselineRangeOutsideAnImpactSpike() {
        // The 0-30 range is the documented baseline; a scripted impact spike deliberately exceeds it
        // (asserted separately below), so this test only constrains the non-spike readings.
        MotionEmitter emitter = new MotionEmitter("resident-01");
        for (int i = 0; i < ITERATIONS; i++) {
            double value = emitter.nextAccelerometer().getValue();
            assertTrue(value >= 0.0, () -> "accelerometer value " + value + " below 0");
            if (value <= 30.0) {
                continue;
            }
            // Only a genuine impact spike may exceed the baseline ceiling, and it must clear the 12g threshold.
            assertTrue(value > 117.6, () -> "out-of-baseline accelerometer value " + value + " is not a valid impact spike");
        }
    }

    @Test
    void gyroscopeStaysWithinDocumentedBounds() {
        MotionEmitter emitter = new MotionEmitter("resident-01");
        for (int i = 0; i < ITERATIONS; i++) {
            SensorReading reading = emitter.nextGyroscope();
            assertWithinBounds(reading.getValue(), 0.0, 500.0);
        }
    }

    @Test
    void occasionallyScriptsAFreeFallBelowThreshold() {
        // The free-fall threshold FallFogNode reacts to is magnitude < 2.0 m/s2; over enough samples the
        // scripted burst must produce at least one reading down in that band.
        MotionEmitter emitter = new MotionEmitter("resident-01");
        boolean sawFreeFall = false;
        for (int i = 0; i < ITERATIONS && !sawFreeFall; i++) {
            if (emitter.nextAccelerometer().getValue() < 2.0) {
                sawFreeFall = true;
            }
        }
        assertTrue(sawFreeFall, "expected at least one scripted free-fall reading below 2.0 m/s2");
    }

    @Test
    void freeFallBurstIsFollowedByAnImpactSpike() {
        // Once a free-fall dip is observed, the emitter's own scripted burst must produce an impact
        // spike above 117.6 m/s2 (12g) within the next few readings, per FallFogNode's contract.
        MotionEmitter emitter = new MotionEmitter("resident-01");
        boolean sawImpactAfterFreeFall = false;
        outer:
        for (int i = 0; i < ITERATIONS; i++) {
            if (emitter.nextAccelerometer().getValue() < 2.0) {
                for (int j = 0; j < 10; j++) {
                    if (emitter.nextAccelerometer().getValue() > 117.6) {
                        sawImpactAfterFreeFall = true;
                        break outer;
                    }
                }
            }
        }
        assertTrue(sawImpactAfterFreeFall, "expected an impact spike shortly after a scripted free-fall dip");
    }

    private void assertWithinBounds(double value, double min, double max) {
        assertTrue(value >= min && value <= max, () -> "value " + value + " outside [" + min + "," + max + "]");
    }
}
