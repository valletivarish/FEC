package edu.msc.chainfrost.fog.tempfog;

import java.time.Duration;
import java.time.Instant;
import java.util.ArrayDeque;
import java.util.ArrayList;
import java.util.Deque;
import java.util.List;

/**
 * Per-zone rolling state: a 15-minute reading window for MKT plus the timestamp
 * a sustained excursion began, so TempFogNode can tell instantaneous from sustained.
 */
class ZoneWindow {

    private static final Duration WINDOW_LENGTH = Duration.ofMinutes(15);

    private final Deque<TimedTemperature> readings = new ArrayDeque<>();
    private double setpointCelsius;
    private Instant breachStartedAt;
    private Instant lastWarnDispatchedAt;

    void recordSetpoint(double setpointCelsius) {
        this.setpointCelsius = setpointCelsius;
    }

    double setpoint() {
        return setpointCelsius;
    }

    void addReading(double temperatureCelsius, Instant timestamp) {
        readings.addLast(new TimedTemperature(temperatureCelsius, timestamp));
        evictOlderThan(timestamp.minus(WINDOW_LENGTH));
    }

    private void evictOlderThan(Instant cutoff) {
        while (!readings.isEmpty() && readings.peekFirst().timestamp().isBefore(cutoff)) {
            readings.pollFirst();
        }
    }

    List<Double> temperaturesInWindow() {
        List<Double> values = new ArrayList<>(readings.size());
        for (TimedTemperature reading : readings) {
            values.add(reading.temperatureCelsius());
        }
        return values;
    }

    boolean hasReadings() {
        return !readings.isEmpty();
    }

    /** Count of readings currently buffered in the rolling window - the node's real in-memory queue depth. */
    int bufferedReadingCount() {
        return readings.size();
    }

    Instant breachStartedAt() {
        return breachStartedAt;
    }

    void markBreachStarted(Instant at) {
        if (breachStartedAt == null) {
            breachStartedAt = at;
        }
    }

    void clearBreach() {
        breachStartedAt = null;
    }

    Instant lastWarnDispatchedAt() {
        return lastWarnDispatchedAt;
    }

    void markWarnDispatched(Instant at) {
        lastWarnDispatchedAt = at;
    }

    private record TimedTemperature(double temperatureCelsius, Instant timestamp) {
    }
}
