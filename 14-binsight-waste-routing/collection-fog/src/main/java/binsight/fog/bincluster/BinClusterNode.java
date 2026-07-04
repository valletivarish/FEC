package binsight.fog.bincluster;

import binsight.fog.model.SensorReading;

import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
import java.util.Map;

/**
 * Cross-checks a bin's fill level against its weight to catch sensor faults (jammed
 * ultrasonic) and tamper/inconsistency (weight drifting while the lid is shut).
 */
public class BinClusterNode {

    private static final double CAPACITY_KG = 240.0;

    private final Map<String, Double> latestFillLevelPct = new HashMap<>();
    private final Map<String, Double> latestBinWeightKg = new HashMap<>();
    private final Map<String, String> latestLidState = new HashMap<>();
    private final Map<String, Integer> tickCounters = new HashMap<>();

    public List<Map<String, Object>> onReading(SensorReading reading) {
        String binId = reading.getEntityId();
        String metric = reading.getMetric();

        switch (metric) {
            case "fill-level":
                latestFillLevelPct.put(binId, reading.numericValue());
                break;
            case "bin-weight":
                latestBinWeightKg.put(binId, reading.numericValue());
                break;
            case "lid-state":
                latestLidState.put(binId, reading.stringValue());
                break;
            default:
                return List.of();
        }

        // Tick counter advances on every onReading call for this bin, any of the 3 tracked metrics.
        int tick = tickCounters.merge(binId, 1, Integer::sum);

        // Verdict recomputation itself only matters once fill-level/bin-weight/lid-state are all known.
        if (!metric.equals("fill-level") && !metric.equals("bin-weight")) {
            return List.of();
        }

        if (!latestFillLevelPct.containsKey(binId)
                || !latestBinWeightKg.containsKey(binId)
                || !latestLidState.containsKey(binId)) {
            return List.of();
        }

        double fillLevelPct = latestFillLevelPct.get(binId);
        double binWeightKg = latestBinWeightKg.get(binId);
        String lidState = latestLidState.get(binId);
        double expectedWeightKg = expectedWeightKg(fillLevelPct);

        String verdict = computeVerdict(fillLevelPct, binWeightKg, lidState, expectedWeightKg);

        boolean dispatchWorthy = (tick % 8 == 0) && !verdict.equals("NORMAL");
        if (!dispatchWorthy) {
            return List.of();
        }

        Map<String, Object> event = new HashMap<>();
        event.put("type", "cluster_verdict");
        event.put("binId", binId);
        event.put("verdict", verdict);
        event.put("fillLevelPct", fillLevelPct);
        event.put("binWeightKg", binWeightKg);
        event.put("expectedWeightKg", expectedWeightKg);
        event.put("timestamp", reading.getTimestamp());

        List<Map<String, Object>> events = new ArrayList<>();
        events.add(event);
        return events;
    }

    // 100% full maps to full 240kg capacity — a simple linear commissioning baseline.
    public double expectedWeightKg(double fillLevelPct) {
        return fillLevelPct / 100.0 * CAPACITY_KG;
    }

    private String computeVerdict(double fillLevelPct, double binWeightKg, String lidState, double expectedWeightKg) {
        if (fillLevelPct >= 85 && binWeightKg < 10) {
            return "POSSIBLE_FALSE_FULL";
        }
        if (lidState.equals("CLOSED") && Math.abs(binWeightKg - expectedWeightKg) > 0.35 * expectedWeightKg) {
            return "INCONSISTENT";
        }
        return "NORMAL";
    }
}
