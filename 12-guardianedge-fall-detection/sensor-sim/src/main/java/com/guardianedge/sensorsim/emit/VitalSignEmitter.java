package com.guardianedge.sensorsim.emit;

import com.guardianedge.sensorsim.model.SensorReading;
import java.time.Instant;
import java.util.concurrent.ThreadLocalRandom;

/**
 * Generates heartrate, spo2, resprate, skintemp and ecgrr readings via a bounded random walk.
 * Each resident gets its own emitter instance so drift state never leaks across residents.
 */
public final class VitalSignEmitter {

    private static final double HEARTRATE_MIN = 40;
    private static final double HEARTRATE_MAX = 180;
    private static final double SPO2_MIN = 80;
    private static final double SPO2_MAX = 100;
    private static final double RESPRATE_MIN = 6;
    private static final double RESPRATE_MAX = 40;
    private static final double SKINTEMP_MIN = 33;
    private static final double SKINTEMP_MAX = 40;
    private static final double ECGRR_MIN = 400;
    private static final double ECGRR_MAX = 1600;

    // Alert-band bias only fires occasionally so downstream fog hysteresis has real transitions to exercise.
    private static final double ALERT_BIAS_PROBABILITY = 0.06;

    private final String residentId;
    private final ThreadLocalRandom random = ThreadLocalRandom.current();

    private double heartrate = 72;
    private double spo2 = 97;
    private double resprate = 16;
    private double skintemp = 36.5;
    private double ecgrr = 833;

    public VitalSignEmitter(String residentId) {
        this.residentId = residentId;
    }

    public SensorReading nextHeartrate() {
        heartrate = biasedWalk(heartrate, HEARTRATE_MIN, HEARTRATE_MAX, 3.0, 44, 135);
        return reading("heartrate", heartrate, "bpm");
    }

    public SensorReading nextSpo2() {
        spo2 = biasedWalk(spo2, SPO2_MIN, SPO2_MAX, 1.0, 87, SPO2_MAX);
        return reading("spo2", spo2, "%");
    }

    public SensorReading nextResprate() {
        resprate = biasedWalk(resprate, RESPRATE_MIN, RESPRATE_MAX, 1.5, 7, 30);
        return reading("resprate", resprate, "breaths/min");
    }

    public SensorReading nextSkintemp() {
        skintemp = biasedWalk(skintemp, SKINTEMP_MIN, SKINTEMP_MAX, 0.25, 34.2, 38.8);
        return reading("skintemp", skintemp, "degC");
    }

    public SensorReading nextEcgrr() {
        ecgrr = biasedWalk(ecgrr, ECGRR_MIN, ECGRR_MAX, 40.0, 550, 1200);
        return reading("ecgrr", ecgrr, "ms");
    }

    /** Random walk clamped to [min,max]; occasionally nudges toward an alert-band anchor instead of the last value. */
    private double biasedWalk(double current, double min, double max, double stepSize, double alertLow, double alertHigh) {
        double base = current;
        if (random.nextDouble() < ALERT_BIAS_PROBABILITY) {
            base = random.nextBoolean() ? alertLow : alertHigh;
        }
        double next = base + random.nextDouble(-stepSize, stepSize);
        return clamp(next, min, max);
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
