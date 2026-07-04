package edu.msc.floodwatch.fog.meteo;

import java.util.HashMap;
import java.util.Map;

/**
 * Pure catchment-state tracker shared by reference across all reaches' MeteoFogNode
 * instances. Deliberately knows nothing about HydroFogNode; cross-node wiring stays in
 * MeteoFogNode so this class stays a simple aggregator.
 */
public class CatchmentCorrelator {

    private static final double RAINFALL_ESCALATION_THRESHOLD = 15.0;
    private static final int MIN_REACHES_WITH_HEAVY_RAINFALL = 2;
    private static final int MIN_REACHES_WITH_PRESTORM_SIGNAL = 1;

    private final Map<String, Double> latestRainfallByReach = new HashMap<>();
    private final Map<String, Boolean> preStormSignalByReach = new HashMap<>();

    public void updateRainfall(String reachId, double rainfall) {
        latestRainfallByReach.put(reachId, rainfall);
    }

    public void updatePreStormSignal(String reachId, boolean active) {
        preStormSignalByReach.put(reachId, active);
    }

    public boolean shouldEscalate() {
        long heavyRainfallReaches = latestRainfallByReach.values().stream()
                .filter(rainfall -> rainfall > RAINFALL_ESCALATION_THRESHOLD)
                .count();
        long preStormReaches = preStormSignalByReach.values().stream()
                .filter(Boolean::booleanValue)
                .count();

        return heavyRainfallReaches >= MIN_REACHES_WITH_HEAVY_RAINFALL
                && preStormReaches >= MIN_REACHES_WITH_PRESTORM_SIGNAL;
    }
}
