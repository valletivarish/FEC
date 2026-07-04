package edu.msc.floodwatch.fog.hydro;

import java.time.Instant;
import java.util.ArrayDeque;
import java.util.Deque;
import java.util.HashMap;
import java.util.List;
import java.util.Map;

/**
 * Tracks river-level trend and flood stage per reach, escalating dispatch cadence once
 * risk rises and reacting to cross-reach storm warnings from MeteoFogNode. Wired one
 * instance per reach; the escalation countdown is a single field scoped to that reach.
 */
public class HydroFogNode {

    private static final int WINDOW_SIZE = 12;
    private static final int ESCALATION_EXPIRY_TICKS = 4;
    private static final int AMBER_RED_DISPATCH_EVERY_N = 4;

    // Below this slope a flow-rate window reads as flat/falling rather than genuinely rising.
    private static final double FLOW_RATE_FLAT_SLOPE = 0.5;

    private final Map<String, Deque<Double>> riverLevelWindows = new HashMap<>();
    private final Map<String, Deque<Double>> flowRateWindows = new HashMap<>();
    private final Map<String, Double> latestSoilSaturation = new HashMap<>();
    private final Map<String, Stage> lastDispatchedStage = new HashMap<>();
    private final Map<String, Integer> tickCounters = new HashMap<>();

    // Escalation is armed by the paired MeteoFogNode for this instance's reach; a single
    // counter is sufficient because the contract wires one HydroFogNode per reach.
    private int escalationCountdown = 0;

    public List<Map<String, Object>> onReading(Map<String, Object> reading) {
        String reachId = (String) reading.get("reachId");
        String metric = (String) reading.get("metric");

        if ("soil-saturation".equals(metric)) {
            latestSoilSaturation.put(reachId, toDouble(reading.get("value")));
            return List.of();
        }
        if ("flow-rate".equals(metric)) {
            Deque<Double> flowWindow = flowRateWindows.computeIfAbsent(reachId, k -> new ArrayDeque<>());
            flowWindow.addLast(toDouble(reading.get("value")));
            if (flowWindow.size() > WINDOW_SIZE) {
                flowWindow.removeFirst();
            }
            return List.of();
        }
        if (!"river-level".equals(metric)) {
            return List.of();
        }

        double riverLevel = toDouble(reading.get("value"));
        Deque<Double> window = riverLevelWindows.computeIfAbsent(reachId, k -> new ArrayDeque<>());
        window.addLast(riverLevel);
        if (window.size() > WINDOW_SIZE) {
            window.removeFirst();
        }

        double soilSaturation = latestSoilSaturation.getOrDefault(reachId, 0.0);
        double rateOfRise = regressionSlope(window);
        Deque<Double> flowWindow = flowRateWindows.get(reachId);
        boolean haveFlowRateSignal = flowWindow != null && flowWindow.size() >= 2;
        double flowRateSlope = haveFlowRateSignal ? regressionSlope(flowWindow) : 0.0;

        // Level rising while discharge stays flat/falling points at an obstruction throttling
        // flow downstream rather than the rise being explained by increased flow volume.
        boolean blockageSuspected = haveFlowRateSignal && rateOfRise > 0 && flowRateSlope <= FLOW_RATE_FLAT_SLOPE;

        Stage naturalStage = StageClassifier.classify(riverLevel, soilSaturation);
        Stage effectiveStage = naturalStage;
        boolean crossReachEscalated = false;

        if (escalationCountdown > 0) {
            Stage forced = naturalStage.escalateOnce();
            if (forced != naturalStage) {
                effectiveStage = forced;
                crossReachEscalated = true;
            }
            // each subsequent tick counts down regardless of effect; real threshold crossing
            // up to the forced level also confirms/clears it early since nothing is left to force
            escalationCountdown--;
            if (forced == naturalStage || escalationCountdown <= 0) {
                escalationCountdown = 0;
            }
        }

        Stage previousStage = lastDispatchedStage.get(reachId);
        boolean isTransition = !effectiveStage.equals(previousStage);

        int tick = tickCounters.merge(reachId, 1, Integer::sum);
        boolean cadenceDispatch = (effectiveStage == Stage.AMBER || effectiveStage == Stage.RED)
                && tick % AMBER_RED_DISPATCH_EVERY_N == 0;

        // A suspected blockage is dispatch-worthy on its own since it can precede any
        // threshold crossing the cadence check would otherwise wait on.
        if (!isTransition && !cadenceDispatch && !blockageSuspected) {
            return List.of();
        }

        lastDispatchedStage.put(reachId, effectiveStage);

        Map<String, Object> event = new HashMap<>();
        event.put("type", "hydro_event");
        event.put("reachId", reachId);
        event.put("stage", effectiveStage.name());
        event.put("riverLevel", riverLevel);
        event.put("rateOfRise", rateOfRise);
        event.put("soilSaturationAmplified", StageClassifier.isAmplified(soilSaturation));
        event.put("crossReachEscalated", crossReachEscalated);
        event.put("flowRateSlope", flowRateSlope);
        event.put("blockageSuspected", blockageSuspected);
        event.put("timestamp", Instant.now().toString());
        return List.of(event);
    }

    /**
     * Called by MeteoFogNode's catchment correlator when a catchment-wide pre-storm signal
     * fires. Forces the next stage evaluation one level higher than the threshold table says,
     * auto-expiring after {@value #ESCALATION_EXPIRY_TICKS} onReading calls unless the real
     * threshold crossing confirms it first.
     */
    public void applyCrossReachEscalation(String reason) {
        escalationCountdown = ESCALATION_EXPIRY_TICKS;
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
