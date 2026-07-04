package edu.msc.floodwatch.fog.meteo;

import edu.msc.floodwatch.fog.hydro.HydroFogNode;

import java.time.Instant;
import java.util.ArrayDeque;
import java.util.Deque;
import java.util.HashMap;
import java.util.List;
import java.util.Map;

/**
 * Watches barometric pressure for a pre-storm signal and feeds rainfall/pressure state into
 * the shared catchment correlator, escalating its own reach's HydroFogNode when the
 * catchment-wide storm pattern crosses the correlator's threshold.
 */
public class MeteoFogNode {

    private static final int WINDOW_SIZE = 8;
    private static final double PRE_STORM_SLOPE_THRESHOLD = -0.5;

    private final String reachId;
    private final CatchmentCorrelator correlator;
    private final HydroFogNode ownHydroFogNode;

    private final Deque<Double> pressureWindow = new ArrayDeque<>();
    private boolean preStormSignalActive = false;
    private boolean escalationWasActive = false;

    public MeteoFogNode(String reachId, CatchmentCorrelator correlator, HydroFogNode ownHydroFogNode) {
        this.reachId = reachId;
        this.correlator = correlator;
        this.ownHydroFogNode = ownHydroFogNode;
    }

    public List<Map<String, Object>> onReading(Map<String, Object> reading) {
        String metric = (String) reading.get("metric");

        if ("rainfall".equals(metric)) {
            correlator.updateRainfall(reachId, toDouble(reading.get("value")));
            return evaluateEscalation();
        }
        if (!"barometric-pressure".equals(metric)) {
            return List.of();
        }

        double pressure = toDouble(reading.get("value"));
        pressureWindow.addLast(pressure);
        if (pressureWindow.size() > WINDOW_SIZE) {
            pressureWindow.removeFirst();
        }

        double slope = regressionSlope(pressureWindow);
        boolean newSignal = slope <= PRE_STORM_SLOPE_THRESHOLD;
        boolean signalTransitioned = newSignal != preStormSignalActive;
        preStormSignalActive = newSignal;
        correlator.updatePreStormSignal(reachId, preStormSignalActive);

        List<Map<String, Object>> escalationEvents = evaluateEscalation();
        if (!escalationEvents.isEmpty()) {
            return escalationEvents;
        }

        if (signalTransitioned) {
            return List.of(buildEvent(slope, preStormSignalActive, false));
        }
        return List.of();
    }

    private List<Map<String, Object>> evaluateEscalation() {
        boolean escalateNow = correlator.shouldEscalate();
        boolean newlyTrue = escalateNow && !escalationWasActive;
        escalationWasActive = escalateNow;

        if (!newlyTrue) {
            return List.of();
        }

        ownHydroFogNode.applyCrossReachEscalation("catchment-wide pre-storm rainfall pattern");
        double slope = regressionSlope(pressureWindow);
        return List.of(buildEvent(slope, preStormSignalActive, true));
    }

    private Map<String, Object> buildEvent(double pressureSlope, boolean preStormSignal, boolean preWarnEscalation) {
        Map<String, Object> event = new HashMap<>();
        event.put("type", "meteo_event");
        event.put("reachId", reachId);
        event.put("pressureSlope", pressureSlope);
        event.put("preStormSignal", preStormSignal);
        event.put("preWarnEscalation", preWarnEscalation);
        event.put("timestamp", Instant.now().toString());
        return event;
    }

    private static double regressionSlope(Deque<Double> window) {
        int n = window.size();
        if (n < 2) {
            return 0.0;
        }
        double sumX = 0, sumY = 0, sumXY = 0, sumXX = 0;
        int i = 0;
        for (double y : window) {
            sumX += i;
            sumY += y;
            sumXY += (double) i * y;
            sumXX += (double) i * i;
            i++;
        }
        double denominator = n * sumXX - sumX * sumX;
        if (denominator == 0) {
            return 0.0;
        }
        return (n * sumXY - sumX * sumY) / denominator;
    }

    private static double toDouble(Object value) {
        if (value instanceof Number number) {
            return number.doubleValue();
        }
        return Double.parseDouble(value.toString());
    }
}
