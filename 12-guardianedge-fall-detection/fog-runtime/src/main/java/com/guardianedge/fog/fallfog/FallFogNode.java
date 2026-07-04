package com.guardianedge.fog.fallfog;

import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.concurrent.ConcurrentHashMap;

/**
 * Per-resident 5-state FSM detecting a genuine fall from an accelerometer free-fall/impact
 * signature confirmed by a subsequent period of gyroscope stillness.
 */
public class FallFogNode {

    private static final int FREE_FALL_CONSECUTIVE_READINGS = 3;
    private static final double FREE_FALL_THRESHOLD = 2.0;
    private static final int IMPACT_WINDOW_READINGS = 5;
    private static final double IMPACT_THRESHOLD = 117.6;
    private static final int STILLNESS_WINDOW_READINGS = 5;
    private static final double STILLNESS_MOVEMENT_THRESHOLD = 50.0;
    private static final double STILLNESS_STDDEV_THRESHOLD = 5.0;

    private final Map<String, ResidentFallTracker> trackersByResident = new ConcurrentHashMap<>();

    public List<Map<String, Object>> onReading(Map<String, Object> reading) {
        String residentId = (String) reading.get("residentId");
        String metric = (String) reading.get("metric");
        double value = ((Number) reading.get("value")).doubleValue();
        String timestamp = (String) reading.get("timestamp");

        ResidentFallTracker tracker = trackersByResident.computeIfAbsent(residentId, id -> new ResidentFallTracker());

        if (tracker.state == FallState.FALL_CONFIRMED) {
            return List.of();
        }

        if ("accelerometer".equals(metric)) {
            return handleAccelerometer(tracker, residentId, value, timestamp);
        }
        if ("gyroscope".equals(metric)) {
            return handleGyroscope(tracker, residentId, value, timestamp);
        }
        return List.of();
    }

    private List<Map<String, Object>> handleAccelerometer(ResidentFallTracker tracker, String residentId,
                                                            double magnitude, String timestamp) {
        switch (tracker.state) {
            case MONITORING -> {
                if (magnitude < FREE_FALL_THRESHOLD) {
                    tracker.consecutiveFreeFallReadings++;
                    if (tracker.consecutiveFreeFallReadings >= FREE_FALL_CONSECUTIVE_READINGS) {
                        tracker.state = FallState.FREE_FALL;
                        tracker.impactWindowReadingsLeft = IMPACT_WINDOW_READINGS;
                    }
                } else {
                    tracker.consecutiveFreeFallReadings = 0;
                }
            }
            case FREE_FALL -> {
                if (magnitude > IMPACT_THRESHOLD) {
                    tracker.state = FallState.IMPACT;
                    tracker.consecutiveFreeFallReadings = 0;
                    tracker.impactAccelMagnitude = magnitude;
                    return enterStillnessConfirm(tracker);
                }
                tracker.impactWindowReadingsLeft--;
                if (tracker.impactWindowReadingsLeft <= 0) {
                    // No impact followed the free-fall indication within the window: false trigger.
                    tracker.reset();
                }
            }
            default -> {
                // IMPACT/STILLNESS_CONFIRM only consume gyroscope readings; ignore accelerometer here.
            }
        }
        return List.of();
    }

    private List<Map<String, Object>> enterStillnessConfirm(ResidentFallTracker tracker) {
        tracker.state = FallState.STILLNESS_CONFIRM;
        tracker.stillnessGyroReadings.clear();
        return List.of();
    }

    private List<Map<String, Object>> handleGyroscope(ResidentFallTracker tracker, String residentId,
                                                        double magnitude, String timestamp) {
        if (tracker.state != FallState.STILLNESS_CONFIRM) {
            return List.of();
        }

        if (magnitude > STILLNESS_MOVEMENT_THRESHOLD) {
            // Clear normal movement during the stillness window: false-positive suppression.
            tracker.reset();
            return List.of();
        }

        tracker.stillnessGyroReadings.add(magnitude);
        if (tracker.stillnessGyroReadings.size() < STILLNESS_WINDOW_READINGS) {
            return List.of();
        }

        double stddev = populationStdDev(tracker.stillnessGyroReadings);
        tracker.stillnessGyroReadings.clear();

        if (stddev < STILLNESS_STDDEV_THRESHOLD) {
            tracker.state = FallState.FALL_CONFIRMED;
            Map<String, Object> event = new HashMap<>();
            event.put("type", "fall_event");
            event.put("residentId", residentId);
            event.put("state", "FALL_CONFIRMED");
            event.put("accelMagnitude", tracker.impactAccelMagnitude);
            event.put("timestamp", timestamp);
            return List.of(event);
        }

        // Small but not clearly-normal movement: keep collecting fresh readings, stay put.
        return List.of();
    }

    private double populationStdDev(List<Double> values) {
        double mean = values.stream().mapToDouble(Double::doubleValue).average().orElse(0.0);
        double sumSquaredDiff = values.stream().mapToDouble(v -> (v - mean) * (v - mean)).sum();
        return Math.sqrt(sumSquaredDiff / values.size());
    }

    public void resetResident(String residentId) {
        ResidentFallTracker tracker = trackersByResident.get(residentId);
        if (tracker != null) {
            tracker.reset();
        }
    }
}
