package ie.nci.flowforge.fn3integrity;

import java.util.ArrayDeque;
import java.util.Deque;
import java.util.HashMap;
import java.util.List;
import java.util.Map;

/**
 * Tracks seal-leak state per pump through a hysteresis band (to avoid
 * flapping right at a threshold) plus a trend-slope escalation to CRITICAL,
 * corroborated by the pump's latest turbidity reading where available.
 */
public class IntegrityNode {

    private enum State {
        LEAK_OK, LEAK_WATCH, LEAK_CRITICAL
    }

    private static final int WINDOW_SIZE = 10;
    private static final int MIN_SAMPLES_FOR_TREND = 6;
    private static final double UPPER_THRESHOLD = 30.0;
    private static final double LOWER_THRESHOLD = 15.0;
    private static final double TREND_SLOPE_THRESHOLD = 0.4;
    // contamination alongside a confirmed leak is a stronger fault signature than either alone
    private static final double TURBIDITY_CONTAMINATION_THRESHOLD = 25.0;

    private final Map<String, Deque<Double>> sealLeakWindows = new HashMap<>();
    private final Map<String, State> states = new HashMap<>();
    private final Map<String, Double> latestTurbidity = new HashMap<>();

    public List<Map<String, Object>> onReading(Map<String, Object> reading) {
        String pumpId = (String) reading.get("pumpId");
        String metric = (String) reading.get("metric");
        if (pumpId == null || metric == null) {
            return List.of();
        }

        if ("turbidity".equals(metric)) {
            latestTurbidity.put(pumpId, toDouble(reading.get("value")));
            return List.of();
        }

        if (!"seal-leak".equals(metric)) {
            return List.of();
        }

        double value = toDouble(reading.get("value"));
        Deque<Double> window = sealLeakWindows.computeIfAbsent(pumpId, k -> new ArrayDeque<>());
        window.addLast(value);
        if (window.size() > WINDOW_SIZE) {
            window.removeFirst();
        }

        State currentState = states.getOrDefault(pumpId, State.LEAK_OK);
        double trendSlope = window.size() >= MIN_SAMPLES_FOR_TREND ? linearRegressionSlope(window) : 0.0;
        Double turbidity = latestTurbidity.get(pumpId);

        State nextState = nextState(currentState, value, trendSlope, window.size(), turbidity);

        if (nextState == currentState) {
            states.put(pumpId, nextState);
            return List.of();
        }

        states.put(pumpId, nextState);

        Map<String, Object> event = new HashMap<>();
        event.put("type", "integrity_event");
        event.put("pumpId", pumpId);
        event.put("state", nextState.name());
        event.put("sealLeak", value);
        event.put("trendSlope", trendSlope);
        event.put("turbidity", turbidity);
        event.put("timestamp", reading.get("timestamp"));

        return List.of(event);
    }

    private static State nextState(State currentState, double value, double trendSlope, int windowSize,
            Double turbidity) {
        switch (currentState) {
            case LEAK_OK:
                if (value > UPPER_THRESHOLD) {
                    return State.LEAK_WATCH;
                }
                return State.LEAK_OK;
            case LEAK_WATCH:
                if (value < LOWER_THRESHOLD) {
                    return State.LEAK_OK;
                }
                // escalation only reachable from an already-confirmed leak, never straight from LEAK_OK
                if (windowSize >= MIN_SAMPLES_FOR_TREND && trendSlope > TREND_SLOPE_THRESHOLD) {
                    return State.LEAK_CRITICAL;
                }
                // heavy contamination corroborating a leak still in watch escalates even without a steep trend
                if (turbidity != null && turbidity > TURBIDITY_CONTAMINATION_THRESHOLD) {
                    return State.LEAK_CRITICAL;
                }
                return State.LEAK_WATCH;
            case LEAK_CRITICAL:
                if (value < LOWER_THRESHOLD) {
                    return State.LEAK_OK;
                }
                return State.LEAK_CRITICAL;
            default:
                return currentState;
        }
    }

    private static double linearRegressionSlope(Deque<Double> window) {
        double[] values = window.stream().mapToDouble(Double::doubleValue).toArray();
        int n = values.length;
        double meanX = (n - 1) / 2.0;
        double meanY = 0.0;
        for (double v : values) {
            meanY += v;
        }
        meanY /= n;

        double numerator = 0.0;
        double denominator = 0.0;
        for (int i = 0; i < n; i++) {
            double dx = i - meanX;
            numerator += dx * (values[i] - meanY);
            denominator += dx * dx;
        }
        return denominator == 0.0 ? 0.0 : numerator / denominator;
    }

    private static double toDouble(Object value) {
        if (value instanceof Number number) {
            return number.doubleValue();
        }
        return Double.parseDouble(String.valueOf(value));
    }
}
