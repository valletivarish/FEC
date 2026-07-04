package com.guardianedge.sensorsim.emit;

import com.guardianedge.sensorsim.model.SensorReading;
import java.time.Instant;
import java.util.concurrent.ThreadLocalRandom;

/**
 * Generates accelerometer and gyroscope readings. Mostly calm baseline noise, but every so often
 * scripts a free-fall -> impact -> stillness burst so FallFogNode's FSM sees a genuine end-to-end incident.
 */
public final class MotionEmitter {

    // 0-30 is the documented baseline range; a genuine impact spike deliberately exceeds it (must clear 117.6 = 12g).
    private static final double ACCEL_MIN = 0;
    private static final double ACCEL_BASELINE_MAX = 30;
    private static final double ACCEL_IMPACT_CEILING = 150;
    private static final double GYRO_MIN = 0;
    private static final double GYRO_MAX = 500;

    private static final double BASELINE_ACCEL_G = 9.8;
    private static final double FREEFALL_ACCEL = 1.2;
    private static final double IMPACT_ACCEL = 130.0;
    private static final double STILLNESS_GYRO = 2.0;

    // One in ~200 accelerometer samples kicks off a scripted fall burst.
    private static final double FALL_BURST_PROBABILITY = 0.005;

    private enum BurstStage { NONE, FREE_FALL, IMPACT, STILLNESS }

    private final String residentId;
    private final ThreadLocalRandom random = ThreadLocalRandom.current();

    private BurstStage stage = BurstStage.NONE;
    private int stageReadingsRemaining;

    public MotionEmitter(String residentId) {
        this.residentId = residentId;
    }

    public SensorReading nextAccelerometer() {
        double magnitude = nextAccelMagnitude();
        return reading("accelerometer", magnitude, "m/s2");
    }

    public SensorReading nextGyroscope() {
        double magnitude = nextGyroMagnitude();
        return reading("gyroscope", magnitude, "deg/s");
    }

    private double nextAccelMagnitude() {
        if (stage == BurstStage.NONE && random.nextDouble() < FALL_BURST_PROBABILITY) {
            stage = BurstStage.FREE_FALL;
            stageReadingsRemaining = 3;
        }

        double value;
        double ceiling = ACCEL_BASELINE_MAX;
        switch (stage) {
            case FREE_FALL -> {
                value = FREEFALL_ACCEL + random.nextDouble(-0.4, 0.4);
                stageReadingsRemaining--;
                if (stageReadingsRemaining <= 0) {
                    stage = BurstStage.IMPACT;
                    stageReadingsRemaining = 1;
                }
            }
            case IMPACT -> {
                // Impact spikes must clear the 117.6 m/s2 (12g) threshold, above the 0-30 baseline range.
                value = IMPACT_ACCEL + random.nextDouble(-5, 5);
                ceiling = ACCEL_IMPACT_CEILING;
                stage = BurstStage.STILLNESS;
                stageReadingsRemaining = 5;
            }
            case STILLNESS -> {
                value = BASELINE_ACCEL_G + random.nextDouble(-0.3, 0.3);
                stageReadingsRemaining--;
                if (stageReadingsRemaining <= 0) {
                    stage = BurstStage.NONE;
                }
            }
            default -> value = BASELINE_ACCEL_G + random.nextDouble(-1.0, 1.0);
        }
        return clamp(value, ACCEL_MIN, ceiling);
    }

    private double nextGyroMagnitude() {
        // During a scripted stillness burst gyroscope stays low so FallFogNode's confirm branch can trigger.
        if (stage == BurstStage.STILLNESS) {
            return clamp(STILLNESS_GYRO + random.nextDouble(-1.0, 1.0), GYRO_MIN, GYRO_MAX);
        }
        return clamp(random.nextDouble(0, 25), GYRO_MIN, GYRO_MAX);
    }

    private double clamp(double value, double min, double max) {
        return Math.max(min, Math.min(max, value));
    }

    private SensorReading reading(String metric, double value, String unit) {
        return new SensorReading(residentId, metric, round(value), unit, Instant.now().toString());
    }

    private double round(double value) {
        return Math.round(value * 100.0) / 100.0;
    }
}
