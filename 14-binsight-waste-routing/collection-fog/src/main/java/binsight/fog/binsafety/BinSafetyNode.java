package binsight.fog.binsafety;

import binsight.fog.model.SensorReading;

import java.util.ArrayDeque;
import java.util.ArrayList;
import java.util.Deque;
import java.util.HashMap;
import java.util.List;
import java.util.Map;

/**
 * Watches methane, temperature and tilt per bin for early fire-risk signs. Methane and
 * temp are median-smoothed over a small window to reject single-sample sensor spikes
 * before they influence the score.
 */
public class BinSafetyNode {

    private static final int WINDOW_SIZE = 3;

    private final Map<String, Deque<Double>> methaneWindows = new HashMap<>();
    private final Map<String, Deque<Double>> tempWindows = new HashMap<>();
    private final Map<String, Double> medianMethanePpm = new HashMap<>();
    private final Map<String, Double> medianInternalTempC = new HashMap<>();
    private final Map<String, Double> latestTiltDegrees = new HashMap<>();
    private final Map<String, String> lastDispatchedState = new HashMap<>();

    public List<Map<String, Object>> onReading(SensorReading reading) {
        String binId = reading.getEntityId();
        String metric = reading.getMetric();

        switch (metric) {
            case "methane-ppm":
                updateWindow(methaneWindows, binId, reading.numericValue());
                Deque<Double> methaneWindow = methaneWindows.get(binId);
                if (methaneWindow.size() == WINDOW_SIZE) {
                    medianMethanePpm.put(binId, median(methaneWindow));
                }
                break;
            case "internal-temp":
                updateWindow(tempWindows, binId, reading.numericValue());
                Deque<Double> tempWindow = tempWindows.get(binId);
                if (tempWindow.size() == WINDOW_SIZE) {
                    medianInternalTempC.put(binId, median(tempWindow));
                }
                break;
            case "tilt":
                latestTiltDegrees.put(binId, reading.numericValue());
                break;
            default:
                return List.of();
        }

        if (!medianMethanePpm.containsKey(binId) || !medianInternalTempC.containsKey(binId)) {
            return List.of();
        }

        double methane = medianMethanePpm.get(binId);
        double temp = medianInternalTempC.get(binId);
        double tilt = latestTiltDegrees.getOrDefault(binId, 0.0);

        double score = computeRiskScore(methane, temp, tilt);
        String state = classify(score);

        boolean dispatchWorthy;
        if (state.equals("CRITICAL")) {
            dispatchWorthy = true;
        } else {
            dispatchWorthy = !state.equals(lastDispatchedState.get(binId));
        }
        lastDispatchedState.put(binId, state);

        if (!dispatchWorthy) {
            return List.of();
        }

        Map<String, Object> event = new HashMap<>();
        event.put("type", "fire_risk_alert");
        event.put("binId", binId);
        event.put("riskStatus", state);
        event.put("riskScore", score);
        event.put("medianMethanePpm", methane);
        event.put("medianInternalTempC", temp);
        event.put("tiltDegrees", tilt);
        event.put("timestamp", reading.getTimestamp());

        List<Map<String, Object>> events = new ArrayList<>();
        events.add(event);
        return events;
    }

    public double computeRiskScore(double medianMethanePpm, double medianInternalTempC, double tiltDegrees) {
        double methaneComponent = 0.5 * Math.min(100, medianMethanePpm / 5000.0 * 100);
        double tempComponent = 0.35 * clamp((medianInternalTempC - 25) / (70 - 25) * 100, 0, 100);
        double tiltComponent = 0.15 * (tiltDegrees > 45 ? 100 : 0);
        return methaneComponent + tempComponent + tiltComponent;
    }

    public String classify(double score) {
        if (score >= 70) {
            return "CRITICAL";
        }
        if (score >= 40) {
            return "WATCH";
        }
        return "NORMAL";
    }

    private void updateWindow(Map<String, Deque<Double>> windows, String binId, double value) {
        Deque<Double> window = windows.computeIfAbsent(binId, k -> new ArrayDeque<>(WINDOW_SIZE));
        if (window.size() == WINDOW_SIZE) {
            window.removeFirst();
        }
        window.addLast(value);
    }

    private double median(Deque<Double> window) {
        List<Double> sorted = new ArrayList<>(window);
        sorted.sort(Double::compareTo);
        return sorted.get(sorted.size() / 2);
    }

    private double clamp(double value, double min, double max) {
        return Math.max(min, Math.min(max, value));
    }
}
