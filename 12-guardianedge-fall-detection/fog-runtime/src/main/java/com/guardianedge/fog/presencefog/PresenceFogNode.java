package com.guardianedge.fog.presencefog;

import java.time.Instant;
import java.time.ZoneOffset;
import java.time.format.DateTimeParseException;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.concurrent.ConcurrentHashMap;

/**
 * Per-resident room occupancy debounce, a separate raw-inactivity timer, and occupancy-gated
 * comfort checks (temperature, air quality).
 */
public class PresenceFogNode {

    private static final int INACTIVITY_TICKS_FOR_ALERT = 20;
    private static final int INACTIVITY_HOUR_START = 7;
    private static final int INACTIVITY_HOUR_END = 22;
    private static final double COMFORT_TEMP_LOW = 18.0;
    private static final double COMFORT_TEMP_HIGH = 26.0;
    private static final double AIR_QUALITY_HIGH = 1500.0;

    private final Map<String, OccupancyDebouncer> debouncersByResident = new ConcurrentHashMap<>();
    private final Map<String, Integer> inactivityTicksByResident = new ConcurrentHashMap<>();
    private final Map<String, Boolean> inactivityAlertArmedByResident = new ConcurrentHashMap<>();
    private final Map<String, Boolean> temperatureOutOfBandByResident = new ConcurrentHashMap<>();
    private final Map<String, Boolean> airQualityOutOfBandByResident = new ConcurrentHashMap<>();

    public List<Map<String, Object>> onReading(Map<String, Object> reading) {
        String residentId = (String) reading.get("residentId");
        String metric = (String) reading.get("metric");
        String timestamp = (String) reading.get("timestamp");

        if ("room-pir".equals(metric)) {
            return handlePir(residentId, reading, timestamp);
        }
        if ("room-ambienttemp".equals(metric)) {
            return handleComfort(residentId, "temperature", isTemperatureOutOfBand(numericValue(reading)),
                    temperatureOutOfBandByResident, reading, timestamp);
        }
        if ("room-airquality".equals(metric)) {
            return handleComfort(residentId, "air_quality", numericValue(reading) > AIR_QUALITY_HIGH,
                    airQualityOutOfBandByResident, reading, timestamp);
        }
        return List.of();
    }

    private List<Map<String, Object>> handlePir(String residentId, Map<String, Object> reading, String timestamp) {
        int pirValue = (int) Math.round(numericValue(reading));

        int ticks = inactivityTicksByResident.getOrDefault(residentId, 0);
        boolean armed = inactivityAlertArmedByResident.getOrDefault(residentId, true);
        if (pirValue == 1) {
            ticks = 0;
            armed = true;
        } else {
            ticks++;
        }
        inactivityTicksByResident.put(residentId, ticks);

        OccupancyDebouncer debouncer = debouncersByResident.computeIfAbsent(residentId, id -> new OccupancyDebouncer());
        boolean transitioned = debouncer.addReading(pirValue);

        if (ticks >= INACTIVITY_TICKS_FOR_ALERT && armed && isWithinDayHours(timestamp)) {
            inactivityAlertArmedByResident.put(residentId, false);
            Map<String, Object> event = new HashMap<>();
            event.put("type", "inactivity_alert");
            event.put("residentId", residentId);
            event.put("timestamp", timestamp);
            return List.of(event);
        }
        inactivityAlertArmedByResident.put(residentId, armed);

        if (transitioned) {
            Map<String, Object> event = new HashMap<>();
            event.put("type", "presence_event");
            event.put("residentId", residentId);
            event.put("occupancyState", debouncer.isOccupied() ? "OCCUPIED" : "UNOCCUPIED");
            event.put("timestamp", timestamp);
            return List.of(event);
        }

        return List.of();
    }

    private List<Map<String, Object>> handleComfort(String residentId, String issue, boolean outOfBand,
                                                      Map<String, Boolean> outOfBandTracker,
                                                      Map<String, Object> reading, String timestamp) {
        OccupancyDebouncer debouncer = debouncersByResident.get(residentId);
        boolean occupied = debouncer != null && debouncer.isOccupied();
        if (!occupied) {
            return List.of();
        }

        boolean wasOutOfBand = outOfBandTracker.getOrDefault(residentId, false);
        outOfBandTracker.put(residentId, outOfBand);

        if (outOfBand && !wasOutOfBand) {
            Map<String, Object> event = new HashMap<>();
            event.put("type", "comfort_event");
            event.put("residentId", residentId);
            event.put("issue", issue);
            event.put("value", numericValue(reading));
            event.put("timestamp", timestamp);
            return List.of(event);
        }
        return List.of();
    }

    private boolean isTemperatureOutOfBand(double value) {
        return value < COMFORT_TEMP_LOW || value > COMFORT_TEMP_HIGH;
    }

    private boolean isWithinDayHours(String timestamp) {
        try {
            int hour = Instant.parse(timestamp).atZone(ZoneOffset.UTC).getHour();
            return hour >= INACTIVITY_HOUR_START && hour <= INACTIVITY_HOUR_END;
        } catch (DateTimeParseException e) {
            return false;
        }
    }

    private double numericValue(Map<String, Object> reading) {
        return ((Number) reading.get("value")).doubleValue();
    }
}
