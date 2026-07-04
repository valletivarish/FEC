package com.guardianedge.sensorsim.emit;

import com.guardianedge.sensorsim.model.SensorReading;
import java.time.Instant;
import java.util.concurrent.ThreadLocalRandom;

/** Generates room-pir (motion presence), room-ambienttemp and room-airquality readings for a resident's room. */
public final class RoomEnvEmitter {

    private static final double AMBIENTTEMP_MIN = 10;
    private static final double AMBIENTTEMP_MAX = 35;
    private static final double AIRQUALITY_MIN = 400;
    private static final double AIRQUALITY_MAX = 2000;

    // Occupied rooms trend toward comfort band; a small share of samples excursion out-of-band for comfort-check coverage.
    private static final double COMFORT_BREACH_PROBABILITY = 0.08;

    private final String residentId;
    private final ThreadLocalRandom random = ThreadLocalRandom.current();

    private double ambientTemp = 21.5;
    private double airQuality = 650;
    private boolean lastPirWasMotion = false;

    public RoomEnvEmitter(String residentId) {
        this.residentId = residentId;
    }

    public SensorReading nextRoomPir() {
        // Motion tends to cluster in short bursts rather than toggling every sample.
        double stayProbability = lastPirWasMotion ? 0.6 : 0.75;
        boolean motion = random.nextDouble() < (lastPirWasMotion ? stayProbability : 1 - stayProbability);
        lastPirWasMotion = motion;
        return reading("room-pir", motion ? 1 : 0, "boolean");
    }

    public SensorReading nextRoomAmbientTemp() {
        double target = random.nextDouble() < COMFORT_BREACH_PROBABILITY
                ? (random.nextBoolean() ? 16.0 : 29.0)
                : 22.0;
        ambientTemp = clamp(ambientTemp + (target - ambientTemp) * 0.3 + random.nextDouble(-0.3, 0.3),
                AMBIENTTEMP_MIN, AMBIENTTEMP_MAX);
        return reading("room-ambienttemp", ambientTemp, "degC");
    }

    public SensorReading nextRoomAirQuality() {
        double target = random.nextDouble() < COMFORT_BREACH_PROBABILITY ? 1700.0 : 600.0;
        airQuality = clamp(airQuality + (target - airQuality) * 0.3 + random.nextDouble(-30, 30),
                AIRQUALITY_MIN, AIRQUALITY_MAX);
        return reading("room-airquality", airQuality, "ppm");
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
