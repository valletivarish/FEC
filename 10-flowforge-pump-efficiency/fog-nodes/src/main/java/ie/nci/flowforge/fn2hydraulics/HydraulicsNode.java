package ie.nci.flowforge.fn2hydraulics;

import java.util.HashMap;
import java.util.List;
import java.util.Map;

/**
 * Derives hydraulic efficiency from the 5 tracked metrics and flags pumps
 * drifting below their RPM-dependent commissioning baseline.
 */
public class HydraulicsNode {

    private static final double BAR_TO_METERS = 10.19716;
    private static final double WATER_DENSITY = 1000.0;
    private static final double GRAVITY = 9.81;
    private static final double DEVIATION_WARNING_THRESHOLD = 8.0;
    private static final double DEVIATION_CRITICAL_THRESHOLD = 20.0;
    private static final int DEBOUNCE_CYCLES = 3;

    private final Map<String, Double> latestInletPressure = new HashMap<>();
    private final Map<String, Double> latestOutletPressure = new HashMap<>();
    private final Map<String, Double> latestFlowRate = new HashMap<>();
    private final Map<String, Double> latestPowerDraw = new HashMap<>();
    private final Map<String, Double> latestRpm = new HashMap<>();
    private final Map<String, Integer> consecutiveBreaches = new HashMap<>();

    public List<Map<String, Object>> onReading(Map<String, Object> reading) {
        String pumpId = (String) reading.get("pumpId");
        String metric = (String) reading.get("metric");
        if (pumpId == null || metric == null) {
            return List.of();
        }

        switch (metric) {
            case "inlet-pressure":
                latestInletPressure.put(pumpId, toDouble(reading.get("value")));
                return List.of();
            case "flow-rate":
                latestFlowRate.put(pumpId, toDouble(reading.get("value")));
                return List.of();
            case "power-draw":
                latestPowerDraw.put(pumpId, toDouble(reading.get("value")));
                return List.of();
            case "rpm":
                latestRpm.put(pumpId, toDouble(reading.get("value")));
                return List.of();
            case "outlet-pressure":
                latestOutletPressure.put(pumpId, toDouble(reading.get("value")));
                return onOutletPressureReading(pumpId, reading.get("timestamp"));
            default:
                return List.of();
        }
    }

    private List<Map<String, Object>> onOutletPressureReading(String pumpId, Object timestamp) {
        Double inletPressure = latestInletPressure.get(pumpId);
        Double outletPressure = latestOutletPressure.get(pumpId);
        Double flowRate = latestFlowRate.get(pumpId);
        Double powerDraw = latestPowerDraw.get(pumpId);
        Double rpm = latestRpm.get(pumpId);

        if (inletPressure == null || outletPressure == null || flowRate == null
                || powerDraw == null || rpm == null) {
            return List.of();
        }

        double headMeters = (outletPressure - inletPressure) * BAR_TO_METERS;
        double flowM3s = flowRate / 3600.0;
        double powerWatts = powerDraw * 1000.0;

        double efficiency = powerWatts == 0.0
                ? 0.0
                : (flowM3s * headMeters * WATER_DENSITY * GRAVITY) / powerWatts;
        efficiency = clamp(efficiency, 0.0, 1.0);

        double predictedEfficiency = clamp(0.55 + 0.0001 * (rpm - 1500), 0.3, 0.8);
        double deviationPercentagePoints = (predictedEfficiency - efficiency) * 100.0;

        if (deviationPercentagePoints > DEVIATION_CRITICAL_THRESHOLD) {
            // critical deviation bypasses the debounce entirely, fires on first occurrence
            consecutiveBreaches.put(pumpId, 0);
            return List.of(buildEvent(pumpId, "CRITICAL", efficiency, predictedEfficiency,
                    deviationPercentagePoints, timestamp));
        }

        if (deviationPercentagePoints > DEVIATION_WARNING_THRESHOLD) {
            int breaches = consecutiveBreaches.merge(pumpId, 1, Integer::sum);
            if (breaches >= DEBOUNCE_CYCLES) {
                consecutiveBreaches.put(pumpId, 0);
                return List.of(buildEvent(pumpId, "WARNING", efficiency, predictedEfficiency,
                        deviationPercentagePoints, timestamp));
            }
            return List.of();
        }

        consecutiveBreaches.put(pumpId, 0);
        return List.of();
    }

    private static Map<String, Object> buildEvent(String pumpId, String severity, double efficiency,
            double predictedEfficiency, double deviationPercentagePoints, Object timestamp) {
        Map<String, Object> event = new HashMap<>();
        event.put("type", "hydraulics_event");
        event.put("pumpId", pumpId);
        event.put("severity", severity);
        event.put("efficiency", efficiency);
        event.put("predictedEfficiency", predictedEfficiency);
        event.put("deviationPercentagePoints", deviationPercentagePoints);
        event.put("timestamp", timestamp);
        return event;
    }

    private static double clamp(double value, double min, double max) {
        return Math.max(min, Math.min(max, value));
    }

    private static double toDouble(Object value) {
        if (value instanceof Number number) {
            return number.doubleValue();
        }
        return Double.parseDouble(String.valueOf(value));
    }
}
