package com.guardianedge.fog.vitalsfog;

import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.concurrent.ConcurrentHashMap;

/**
 * Tracks vitals per resident, runs a per-vital hysteresis machine, and derives HRV (SDNN)
 * from ECG RR intervals. Dispatches an event only when a vital's state actually transitions.
 */
public class VitalsFogNode {

    private static final List<String> ALERT_BANDED_VITALS = List.of("heartrate", "spo2", "resprate", "skintemp");
    private static final int CONSECUTIVE_FOR_CRITICAL = 3;
    private static final double LOW_SDNN_THRESHOLD_MS = 20.0;

    private final Map<String, Map<String, VitalState>> statesByResident = new ConcurrentHashMap<>();
    private final Map<String, Map<String, Integer>> innerBreachStreaksByResident = new ConcurrentHashMap<>();
    private final Map<String, Map<String, Double>> latestValuesByResident = new ConcurrentHashMap<>();
    private final Map<String, HrvWindowBuffer> hrvBuffersByResident = new ConcurrentHashMap<>();
    private final Map<String, Double> cachedSdnnByResident = new ConcurrentHashMap<>();

    public List<Map<String, Object>> onReading(Map<String, Object> reading) {
        String residentId = (String) reading.get("residentId");
        String metric = (String) reading.get("metric");
        double value = ((Number) reading.get("value")).doubleValue();
        String timestamp = (String) reading.get("timestamp");

        if ("ecgrr".equals(metric)) {
            handleEcgRr(residentId, value);
            return List.of();
        }

        if (!ALERT_BANDED_VITALS.contains(metric)) {
            return List.of();
        }

        latestValuesFor(residentId).put(metric, value);
        VitalThresholds thresholds = thresholdsFor(metric);
        VitalState previousState = stateFor(residentId, metric);
        VitalState naturalState = nextState(residentId, metric, previousState, thresholds, value);

        VitalState resultingState = naturalState;
        if (naturalState == VitalState.WARNING && shouldCompound(residentId, metric)) {
            resultingState = VitalState.CRITICAL;
        }

        if (resultingState == previousState) {
            statesByResident.get(residentId).put(metric, resultingState);
            return List.of();
        }

        statesByResident.get(residentId).put(metric, resultingState);

        Map<String, Object> event = new HashMap<>();
        event.put("type", "vitals_event");
        event.put("residentId", residentId);
        event.put("vital", metric);
        event.put("previousState", previousState.name());
        event.put("newState", resultingState.name());
        event.put("value", value);
        event.put("sdnnMs", cachedSdnnByResident.get(residentId));
        event.put("timestamp", timestamp);

        List<Map<String, Object>> events = new ArrayList<>();
        events.add(event);
        return events;
    }

    private void handleEcgRr(String residentId, double rrMs) {
        HrvWindowBuffer buffer = hrvBuffersByResident.computeIfAbsent(residentId, id -> new HrvWindowBuffer());
        buffer.addRrInterval(rrMs);
        if (buffer.size() >= 5 && buffer.isRecomputeDue()) {
            cachedSdnnByResident.put(residentId, buffer.computeSdnn());
            buffer.markRecomputed();
        }
    }

    private VitalState nextState(String residentId, String metric, VitalState previousState,
                                  VitalThresholds thresholds, double value) {
        Map<String, Integer> streaks = innerStreaksFor(residentId);

        // Recovery only happens by crossing back over the ORIGINAL outer-safe threshold.
        if (thresholds.withinOuterSafeRange(value)) {
            streaks.put(metric, 0);
            return VitalState.NORMAL;
        }

        // Once CRITICAL, the vital stays CRITICAL until it recovers to the outer-safe range above.
        if (previousState == VitalState.CRITICAL) {
            streaks.put(metric, thresholds.breachesInner(value) ? streaks.getOrDefault(metric, 0) + 1 : 0);
            return VitalState.CRITICAL;
        }

        // Outside outer-safe range but not yet CRITICAL: track the inner-threshold debounce streak.
        if (thresholds.breachesInner(value)) {
            int streak = streaks.getOrDefault(metric, 0) + 1;
            streaks.put(metric, streak);
            return streak >= CONSECUTIVE_FOR_CRITICAL ? VitalState.CRITICAL : VitalState.WARNING;
        }

        // Outer breach but not inner: resets the inner-consecutive streak, stays/enters WARNING.
        streaks.put(metric, 0);
        return VitalState.WARNING;
    }

    private boolean shouldCompound(String residentId, String metric) {
        Double sdnn = cachedSdnnByResident.get(residentId);
        if (sdnn == null || sdnn >= LOW_SDNN_THRESHOLD_MS) {
            return false;
        }
        Map<String, VitalState> states = statesFor(residentId);
        for (Map.Entry<String, VitalState> entry : states.entrySet()) {
            if (entry.getKey().equals(metric)) {
                continue;
            }
            VitalState other = entry.getValue();
            if (other == VitalState.WARNING || other == VitalState.CRITICAL) {
                return true;
            }
        }
        return false;
    }

    private VitalThresholds thresholdsFor(String metric) {
        return switch (metric) {
            case "heartrate" -> VitalThresholds.heartrate();
            case "spo2" -> VitalThresholds.spo2();
            case "resprate" -> VitalThresholds.resprate();
            case "skintemp" -> VitalThresholds.skintemp();
            default -> throw new IllegalArgumentException("Unsupported alert-banded vital: " + metric);
        };
    }

    private VitalState stateFor(String residentId, String metric) {
        return statesFor(residentId).getOrDefault(metric, VitalState.NORMAL);
    }

    private Map<String, VitalState> statesFor(String residentId) {
        return statesByResident.computeIfAbsent(residentId, id -> new HashMap<>());
    }

    private Map<String, Integer> innerStreaksFor(String residentId) {
        return innerBreachStreaksByResident.computeIfAbsent(residentId, id -> new HashMap<>());
    }

    private Map<String, Double> latestValuesFor(String residentId) {
        return latestValuesByResident.computeIfAbsent(residentId, id -> new HashMap<>());
    }
}
