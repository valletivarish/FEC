package edu.msc.floodwatch.fog.quality;

import java.time.Instant;
import java.util.ArrayDeque;
import java.util.ArrayList;
import java.util.Deque;
import java.util.HashMap;
import java.util.List;
import java.util.Map;

/**
 * Computes a composite water quality index per reach and flags sudden contamination,
 * dispatching the two independently: CWQI on band change, contamination immediately.
 */
public class QualityFogNode {

    private static final int WINDOW_SIZE = 12;
    private static final int MIN_SAMPLES_FOR_CONTAMINATION_CHECK = 6;
    private static final double CONTAMINATION_TURBIDITY_MULTIPLIER = 3.0;
    private static final double CONTAMINATION_DO_THRESHOLD = 4.0;
    private static final double UNKNOWN_METRIC_SCALE_MIDPOINT = 50.0;

    private final Map<String, Deque<Double>> turbidityWindows = new HashMap<>();
    private final Map<String, Double> latestWaterTemperature = new HashMap<>();
    private final Map<String, Double> latestDissolvedOxygen = new HashMap<>();
    private final Map<String, Double> latestPh = new HashMap<>();
    private final Map<String, Double> latestConductivity = new HashMap<>();
    private final Map<String, Double> latestTurbidity = new HashMap<>();
    private final Map<String, String> lastDispatchedBand = new HashMap<>();

    public List<Map<String, Object>> onReading(Map<String, Object> reading) {
        String reachId = (String) reading.get("reachId");
        String metric = (String) reading.get("metric");
        double value = toDouble(reading.get("value"));

        boolean tracked = true;
        switch (metric) {
            case "turbidity" -> {
                Deque<Double> window = turbidityWindows.computeIfAbsent(reachId, k -> new ArrayDeque<>());
                window.addLast(value);
                if (window.size() > WINDOW_SIZE) {
                    window.removeFirst();
                }
                latestTurbidity.put(reachId, value);
            }
            case "water-temperature" -> latestWaterTemperature.put(reachId, value);
            case "dissolved-oxygen" -> latestDissolvedOxygen.put(reachId, value);
            case "ph" -> latestPh.put(reachId, value);
            case "conductivity" -> latestConductivity.put(reachId, value);
            default -> tracked = false;
        }
        if (!tracked) {
            return List.of();
        }

        List<Map<String, Object>> events = new ArrayList<>();

        if ("turbidity".equals(metric) || "dissolved-oxygen".equals(metric)) {
            Map<String, Object> contaminationEvent = checkContamination(reachId);
            if (contaminationEvent != null) {
                events.add(contaminationEvent);
            }
        }

        Double dissolvedOxygen = latestDissolvedOxygen.get(reachId);
        Double ph = latestPh.get(reachId);
        Double turbidity = latestTurbidity.get(reachId);
        if (turbidity != null && dissolvedOxygen != null && ph != null) {
            double cwqi = computeCwqi(reachId);
            String band = bandFor(cwqi);
            String previousBand = lastDispatchedBand.get(reachId);
            if (!band.equals(previousBand)) {
                lastDispatchedBand.put(reachId, band);
                Map<String, Object> event = new HashMap<>();
                event.put("type", "quality_event");
                event.put("reachId", reachId);
                event.put("cwqi", cwqi);
                event.put("band", band);
                event.put("timestamp", Instant.now().toString());
                events.add(event);
            }
        }

        return events;
    }

    private double computeCwqi(String reachId) {
        double turbidity = latestTurbidity.get(reachId);
        double dissolvedOxygen = latestDissolvedOxygen.get(reachId);
        double ph = latestPh.get(reachId);
        Double conductivityValue = latestConductivity.get(reachId);
        Double waterTemperatureValue = latestWaterTemperature.get(reachId);

        double turbidityScore = Math.max(0, 100 - turbidity / 8.0);
        double doScore = Math.min(100, dissolvedOxygen * 10.0);
        double phScore = Math.max(0, 100 - Math.abs(ph - 7.2) * 40.0);
        double conductivityScore = conductivityValue != null
                ? Math.max(0, 100 - conductivityValue / 9.0)
                : UNKNOWN_METRIC_SCALE_MIDPOINT;
        double temperatureScore = waterTemperatureValue != null
                ? Math.max(0, 100 - Math.abs(waterTemperatureValue - 15.0) * 5.0)
                : UNKNOWN_METRIC_SCALE_MIDPOINT;

        return turbidityScore * 0.30
                + doScore * 0.25
                + phScore * 0.20
                + conductivityScore * 0.15
                + temperatureScore * 0.10;
    }

    private static String bandFor(double cwqi) {
        if (cwqi >= 70) {
            return "GOOD";
        }
        if (cwqi >= 40) {
            return "FAIR";
        }
        return "POOR";
    }

    private Map<String, Object> checkContamination(String reachId) {
        Deque<Double> window = turbidityWindows.get(reachId);
        Double dissolvedOxygen = latestDissolvedOxygen.get(reachId);
        Double turbidity = latestTurbidity.get(reachId);
        if (window == null || window.size() < MIN_SAMPLES_FOR_CONTAMINATION_CHECK
                || dissolvedOxygen == null || turbidity == null) {
            return null;
        }

        double median = median(window);
        boolean turbiditySpike = turbidity > median * CONTAMINATION_TURBIDITY_MULTIPLIER;
        boolean lowOxygen = dissolvedOxygen < CONTAMINATION_DO_THRESHOLD;

        if (!turbiditySpike || !lowOxygen) {
            return null;
        }

        Map<String, Object> event = new HashMap<>();
        event.put("type", "quality_event");
        event.put("reachId", reachId);
        event.put("contaminationSuspected", true);
        event.put("turbidity", turbidity);
        event.put("dissolvedOxygen", dissolvedOxygen);
        event.put("timestamp", Instant.now().toString());
        return event;
    }

    private static double median(Deque<Double> window) {
        List<Double> sorted = new ArrayList<>(window);
        sorted.sort(Double::compareTo);
        int size = sorted.size();
        int mid = size / 2;
        if (size % 2 == 0) {
            return (sorted.get(mid - 1) + sorted.get(mid)) / 2.0;
        }
        return sorted.get(mid);
    }

    private static double toDouble(Object value) {
        if (value instanceof Number number) {
            return number.doubleValue();
        }
        return Double.parseDouble(value.toString());
    }
}
