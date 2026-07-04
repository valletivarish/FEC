package ie.nci.flowforge.fn1health;

import java.util.ArrayDeque;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.Deque;
import java.util.HashMap;
import java.util.List;
import java.util.Map;

/**
 * Watches vibration for point anomalies (robust z-score) and slow drifts
 * (CUSUM), keyed per pump so one shared instance serves all pumps.
 */
public class HealthNode {

    private static final int WINDOW_SIZE = 20;
    private static final int MIN_SAMPLES_FOR_CHECK = 10;
    private static final double MAD_ANOMALY_THRESHOLD = 3.5;
    private static final int HEARTBEAT_EVERY = 6;

    private final Map<String, Deque<Double>> vibrationWindows = new HashMap<>();
    private final Map<String, Double> latestBearingTemp = new HashMap<>();
    private final Map<String, Double> latestMotorCurrent = new HashMap<>();
    private final Map<String, Double> latestRpm = new HashMap<>();
    private final Map<String, Double> sHigh = new HashMap<>();
    private final Map<String, Double> sLow = new HashMap<>();
    private final Map<String, Integer> tickCount = new HashMap<>();

    public List<Map<String, Object>> onReading(Map<String, Object> reading) {
        String pumpId = (String) reading.get("pumpId");
        String metric = (String) reading.get("metric");
        if (pumpId == null || metric == null) {
            return List.of();
        }

        switch (metric) {
            case "bearing-temp":
                latestBearingTemp.put(pumpId, toDouble(reading.get("value")));
                return List.of();
            case "motor-current":
                latestMotorCurrent.put(pumpId, toDouble(reading.get("value")));
                return List.of();
            case "rpm":
                latestRpm.put(pumpId, toDouble(reading.get("value")));
                return List.of();
            case "vibration":
                return onVibrationReading(pumpId, toDouble(reading.get("value")), reading.get("timestamp"));
            default:
                return List.of();
        }
    }

    private List<Map<String, Object>> onVibrationReading(String pumpId, double value, Object timestamp) {
        Deque<Double> window = vibrationWindows.computeIfAbsent(pumpId, k -> new ArrayDeque<>());
        window.addLast(value);
        if (window.size() > WINDOW_SIZE) {
            window.removeFirst();
        }

        int tick = tickCount.merge(pumpId, 1, Integer::sum);

        boolean madTripped = false;
        double madScore = 0.0;
        boolean cusumTripped = false;

        if (window.size() >= MIN_SAMPLES_FOR_CHECK) {
            double[] values = window.stream().mapToDouble(Double::doubleValue).toArray();
            double median = median(values);
            double mad = medianAbsoluteDeviation(values, median);

            madScore = mad == 0.0 ? 0.0 : 0.6745 * (value - median) / mad;
            madTripped = Math.abs(madScore) > MAD_ANOMALY_THRESHOLD;

            double robustSigma = 1.4826 * mad;
            if (robustSigma != 0.0) {
                double windowMean = Arrays.stream(values).average().orElse(0.0);
                double k = 0.5 * robustSigma;

                double newHigh = Math.max(0.0, sHigh.getOrDefault(pumpId, 0.0) + (value - windowMean) - k);
                double newLow = Math.min(0.0, sLow.getOrDefault(pumpId, 0.0) + (value - windowMean) + k);
                sHigh.put(pumpId, newHigh);
                sLow.put(pumpId, newLow);

                if (newHigh > 5 * robustSigma || newLow < -5 * robustSigma) {
                    cusumTripped = true;
                    sHigh.put(pumpId, 0.0);
                    sLow.put(pumpId, 0.0);
                }
            }
        }

        boolean heartbeat = tick % HEARTBEAT_EVERY == 0;

        if (!madTripped && !cusumTripped && !heartbeat) {
            return List.of();
        }

        String trigger;
        if (madTripped) {
            trigger = "mad_anomaly";
        } else if (cusumTripped) {
            trigger = "cusum_changepoint";
        } else {
            trigger = "heartbeat";
        }

        Map<String, Object> event = new HashMap<>();
        event.put("type", "health_event");
        event.put("pumpId", pumpId);
        event.put("trigger", trigger);
        event.put("madScore", madScore);
        event.put("vibration", value);
        event.put("bearingTemp", latestBearingTemp.get(pumpId));
        event.put("motorCurrent", latestMotorCurrent.get(pumpId));
        event.put("rpm", latestRpm.get(pumpId));
        event.put("timestamp", timestamp);

        List<Map<String, Object>> events = new ArrayList<>();
        events.add(event);
        return events;
    }

    private static double median(double[] values) {
        double[] sorted = values.clone();
        Arrays.sort(sorted);
        int n = sorted.length;
        if (n % 2 == 0) {
            return (sorted[n / 2 - 1] + sorted[n / 2]) / 2.0;
        }
        return sorted[n / 2];
    }

    private static double medianAbsoluteDeviation(double[] values, double median) {
        double[] deviations = new double[values.length];
        for (int i = 0; i < values.length; i++) {
            deviations[i] = Math.abs(values[i] - median);
        }
        return median(deviations);
    }

    private static double toDouble(Object value) {
        if (value instanceof Number number) {
            return number.doubleValue();
        }
        return Double.parseDouble(String.valueOf(value));
    }
}
