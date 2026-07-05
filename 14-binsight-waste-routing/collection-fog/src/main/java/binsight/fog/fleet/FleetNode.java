package binsight.fog.fleet;

import binsight.fog.model.SensorReading;

import java.util.ArrayList;
import java.util.Comparator;
import java.util.HashMap;
import java.util.List;
import java.util.Map;

/**
 * Builds the depot's collection work-list by cross-referencing raw fleet telemetry with
 * the other two fog nodes' own verdicts/alerts, so a truck is only dispatched on genuinely
 * informed priority rather than a single raw sensor value.
 */
public class FleetNode {

    private static final double MOVE_DISTANCE_THRESHOLD_M = 50.0;
    private static final double HEADING_DELTA_THRESHOLD_DEG = 30.0;
    private static final int TICK_TIMEOUT = 5;
    private static final int DISPATCH_EVERY_N_TICKS = 10;
    private static final double METERS_PER_DEGREE = 111320.0;

    private final Map<String, double[]> binLocations; // binId -> {lat, lon}
    private final Map<String, Long> lastCollectedTimestamp; // binId -> epoch millis

    private final Map<String, Double> latestFillLevelPct = new HashMap<>();
    private final Map<String, String> latestDataQualityFlag = new HashMap<>();
    private final Map<String, String> latestRiskStatus = new HashMap<>();

    private final Map<String, double[]> lastRecordedTruckPosition = new HashMap<>(); // truckId -> {lat, lon, headingDeg}
    private final Map<String, Integer> truckTickCounters = new HashMap<>();
    private final Map<String, Double> latestHopperFillPct = new HashMap<>();
    private final Map<String, Double> latestFuelLevelPct = new HashMap<>();

    private double latestWeighbridgeTonnage = 0.0;
    private long mostRecentReadingTimestampMillis = 0L;
    private int globalTick = 0;

    public FleetNode(Map<String, double[]> binLocations, Map<String, Long> lastCollectedTimestamp) {
        this.binLocations = new HashMap<>(binLocations);
        this.lastCollectedTimestamp = new HashMap<>(lastCollectedTimestamp);
    }

    public List<Map<String, Object>> onReading(SensorReading reading) {
        String metric = reading.getMetric();

        switch (metric) {
            case "fill-level":
                latestFillLevelPct.put(reading.getEntityId(), reading.numericValue());
                touchTimestamp(reading);
                break;
            case "truck-gps":
                handleTruckGps(reading);
                touchTimestamp(reading);
                break;
            case "hopper-fill":
                latestHopperFillPct.put(reading.getEntityId(), reading.numericValue());
                touchTimestamp(reading);
                break;
            case "fuel-level":
                latestFuelLevelPct.put(reading.getEntityId(), reading.numericValue());
                touchTimestamp(reading);
                break;
            case "weighbridge-tonnage":
                latestWeighbridgeTonnage = reading.numericValue();
                touchTimestamp(reading);
                break;
            default:
                return List.of();
        }

        return tickAndMaybeDispatch(reading.getTimestamp());
    }

    public List<Map<String, Object>> onBinClusterVerdict(Map<String, Object> event) {
        String binId = (String) event.get("binId");
        latestDataQualityFlag.put(binId, (String) event.get("verdict"));
        return tickAndMaybeDispatch((String) event.get("timestamp"));
    }

    public List<Map<String, Object>> onBinSafetyAlert(Map<String, Object> event) {
        String binId = (String) event.get("binId");
        latestRiskStatus.put(binId, (String) event.get("riskStatus"));
        return tickAndMaybeDispatch((String) event.get("timestamp"));
    }

    @SuppressWarnings("unchecked")
    private void handleTruckGps(SensorReading reading) {
        String truckId = reading.getEntityId();
        Map<String, Object> value = (Map<String, Object>) reading.getValue();
        double lat = ((Number) value.get("lat")).doubleValue();
        double lon = ((Number) value.get("lon")).doubleValue();
        double headingDeg = ((Number) value.get("headingDeg")).doubleValue();

        double[] lastPosition = lastRecordedTruckPosition.get(truckId);
        int tick = truckTickCounters.getOrDefault(truckId, 0);

        if (lastPosition == null) {
            lastRecordedTruckPosition.put(truckId, new double[] {lat, lon, headingDeg});
            truckTickCounters.put(truckId, 0);
            return;
        }

        double distanceMeters = flatEarthDistanceMeters(lat, lon, lastPosition[0], lastPosition[1]);
        double headingDelta = Math.min(Math.abs(headingDeg - lastPosition[2]), 360 - Math.abs(headingDeg - lastPosition[2]));
        tick++;

        boolean shouldRecord = distanceMeters >= MOVE_DISTANCE_THRESHOLD_M
                || headingDelta >= HEADING_DELTA_THRESHOLD_DEG
                || tick >= TICK_TIMEOUT;

        if (shouldRecord) {
            lastRecordedTruckPosition.put(truckId, new double[] {lat, lon, headingDeg});
            truckTickCounters.put(truckId, 0);
        } else {
            truckTickCounters.put(truckId, tick);
        }
    }

    private double flatEarthDistanceMeters(double lat1, double lon1, double lat2, double lon2) {
        double dLat = (lat1 - lat2) * METERS_PER_DEGREE;
        double dLon = (lon1 - lon2) * METERS_PER_DEGREE;
        return Math.sqrt(dLat * dLat + dLon * dLon);
    }

    private void touchTimestamp(SensorReading reading) {
        long millis = parseTimestampMillis(reading.getTimestamp());
        if (millis > mostRecentReadingTimestampMillis) {
            mostRecentReadingTimestampMillis = millis;
        }
    }

    private long parseTimestampMillis(String isoTimestamp) {
        return java.time.Instant.parse(isoTimestamp).toEpochMilli();
    }

    private List<Map<String, Object>> tickAndMaybeDispatch(String currentReadingTimestamp) {
        globalTick++;
        if (globalTick % DISPATCH_EVERY_N_TICKS != 0) {
            return List.of();
        }
        return buildWorkList(currentReadingTimestamp);
    }

    private List<Map<String, Object>> buildWorkList(String dispatchTimestamp) {
        List<Map<String, Object>> items = new ArrayList<>();

        for (String binId : binLocations.keySet()) {
            double fillLevelPct = latestFillLevelPct.getOrDefault(binId, 0.0);
            String riskStatus = latestRiskStatus.get(binId);
            long lastCollected = lastCollectedTimestamp.getOrDefault(binId, mostRecentReadingTimestampMillis);
            double hoursSinceCollection = (mostRecentReadingTimestampMillis - lastCollected) / 3600000.0;

            List<String> dueReasons = new ArrayList<>();
            if (fillLevelPct >= 80) {
                dueReasons.add("HIGH_FILL");
            }
            if ("WATCH".equals(riskStatus) || "CRITICAL".equals(riskStatus)) {
                dueReasons.add("SAFETY_RISK");
            }
            if (hoursSinceCollection > 72) {
                dueReasons.add("OVERDUE");
            }

            if (dueReasons.isEmpty()) {
                continue;
            }

            int safetyWeight = "CRITICAL".equals(riskStatus) ? 2 : "WATCH".equals(riskStatus) ? 1 : 0;
            double fillWeight = fillLevelPct / 100.0;
            double daysOverdue = Math.max(0, hoursSinceCollection / 24.0 - 3.0);
            double priorityScore = safetyWeight * 3 + fillWeight * 1 + daysOverdue * 0.5;

            String assignedTruckId = nearestTruck(binLocations.get(binId));

            Map<String, Object> item = new HashMap<>();
            item.put("binId", binId);
            item.put("priorityScore", priorityScore);
            item.put("dueReasons", dueReasons);
            item.put("assignedTruckId", assignedTruckId);
            item.put("dataQualityFlag", latestDataQualityFlag.get(binId));
            items.add(item);
        }

        items.sort(Comparator.comparingDouble((Map<String, Object> item) -> (Double) item.get("priorityScore")).reversed());

        Map<String, Object> event = new HashMap<>();
        event.put("type", "work_list_event");
        event.put("depotId", "depot-01");
        event.put("items", items);
        event.put("latestWeighbridgeTonnage", latestWeighbridgeTonnage);
        event.put("timestamp", dispatchTimestamp);

        // truck-gps/hopper-fill/fuel-level are otherwise consumed only for internal
        // decimation/priority state and never reach the backend on their own — folding the
        // latest values onto the work-list event (already dispatched every 10 ticks) is what
        // lets the dashboard's fleet-readout panel show genuine data for these 3 sensor types.
        Map<String, Object> fleetTelemetry = latestFleetTelemetry();
        if (fleetTelemetry != null) {
            event.put("fleetTelemetry", fleetTelemetry);
        }

        List<Map<String, Object>> events = new ArrayList<>();
        events.add(event);
        return events;
    }

    // Single-truck depot in this project's scope, but keyed defensively by truckId anyway --
    // picks whichever truck has a recorded GPS fix (falls back to hopper/fuel-only truck ids
    // so those two readings still surface even before a first GPS fix arrives).
    private Map<String, Object> latestFleetTelemetry() {
        String truckId = lastRecordedTruckPosition.keySet().stream().findFirst()
                .orElseGet(() -> latestHopperFillPct.keySet().stream().findFirst()
                        .orElseGet(() -> latestFuelLevelPct.keySet().stream().findFirst().orElse(null)));
        if (truckId == null) {
            return null;
        }

        Map<String, Object> telemetry = new HashMap<>();
        telemetry.put("truckId", truckId);
        double[] position = lastRecordedTruckPosition.get(truckId);
        if (position != null) {
            Map<String, Object> lastPosition = new HashMap<>();
            lastPosition.put("lat", position[0]);
            lastPosition.put("lon", position[1]);
            lastPosition.put("truckId", truckId);
            telemetry.put("lastRecordedPosition", lastPosition);
        }
        telemetry.put("hopperFillPct", latestHopperFillPct.get(truckId));
        telemetry.put("fuelLevelPct", latestFuelLevelPct.get(truckId));
        return telemetry;
    }

    private String nearestTruck(double[] binLocation) {
        String nearestTruckId = null;
        double nearestDistance = Double.MAX_VALUE;

        for (Map.Entry<String, double[]> entry : lastRecordedTruckPosition.entrySet()) {
            double[] truckPosition = entry.getValue();
            double distance = flatEarthDistanceMeters(binLocation[0], binLocation[1], truckPosition[0], truckPosition[1]);
            if (distance < nearestDistance) {
                nearestDistance = distance;
                nearestTruckId = entry.getKey();
            }
        }

        return nearestTruckId;
    }
}
