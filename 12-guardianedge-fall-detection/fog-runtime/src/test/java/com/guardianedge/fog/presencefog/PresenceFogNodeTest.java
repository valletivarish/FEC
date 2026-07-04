package com.guardianedge.fog.presencefog;

import org.junit.jupiter.api.Test;

import java.util.HashMap;
import java.util.List;
import java.util.Map;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertTrue;

class PresenceFogNodeTest {

    private static final String RESIDENT = "resident-03";
    private static final String DAY_TS = "2026-07-02T14:00:00Z";
    private static final String NIGHT_TS = "2026-07-02T03:00:00Z";

    private Map<String, Object> pir(int value, String timestamp) {
        return reading("room-pir", value, timestamp);
    }

    private Map<String, Object> ambientTemp(double value, String timestamp) {
        return reading("room-ambienttemp", value, timestamp);
    }

    private Map<String, Object> airQuality(double value, String timestamp) {
        return reading("room-airquality", value, timestamp);
    }

    private Map<String, Object> reading(String metric, double value, String timestamp) {
        Map<String, Object> r = new HashMap<>();
        r.put("residentId", RESIDENT);
        r.put("metric", metric);
        r.put("value", value);
        r.put("unit", "n/a");
        r.put("timestamp", timestamp);
        return r;
    }

    @Test
    void threeOfFiveOnesTransitionsToOccupied() {
        PresenceFogNode node = new PresenceFogNode();
        node.onReading(pir(0, DAY_TS));
        node.onReading(pir(1, DAY_TS));
        List<Map<String, Object>> events = node.onReading(pir(1, DAY_TS));
        assertTrue(events.stream().noneMatch(e -> "presence_event".equals(e.get("type"))));

        List<Map<String, Object>> transition = node.onReading(pir(1, DAY_TS));
        Map<String, Object> presenceEvent = transition.stream()
                .filter(e -> "presence_event".equals(e.get("type")))
                .findFirst().orElseThrow();
        assertEquals("OCCUPIED", presenceEvent.get("occupancyState"));
    }

    @Test
    void tenConsecutiveZeroesTransitionsBackToUnoccupied() {
        PresenceFogNode node = new PresenceFogNode();
        occupyResident(node);

        for (int i = 0; i < 9; i++) {
            List<Map<String, Object>> events = node.onReading(pir(0, DAY_TS));
            assertTrue(events.stream().noneMatch(e -> "presence_event".equals(e.get("type"))));
        }
        List<Map<String, Object>> events = node.onReading(pir(0, DAY_TS));
        Map<String, Object> presenceEvent = events.stream()
                .filter(e -> "presence_event".equals(e.get("type")))
                .findFirst().orElseThrow();
        assertEquals("UNOCCUPIED", presenceEvent.get("occupancyState"));
    }

    @Test
    void inactivityTimerIsIndependentOfDebouncedOccupancyState() {
        PresenceFogNode node = new PresenceFogNode();
        // Never reaches the 3-of-5 OCCUPIED debounce threshold, but the raw inactivity timer still counts.
        node.onReading(pir(0, DAY_TS));
        node.onReading(pir(1, DAY_TS));
        for (int i = 0; i < 19; i++) {
            node.onReading(pir(0, DAY_TS));
        }
        List<Map<String, Object>> events = node.onReading(pir(0, DAY_TS));
        boolean hasInactivityAlert = events.stream().anyMatch(e -> "inactivity_alert".equals(e.get("type")));
        assertTrue(hasInactivityAlert, "20 readings since last PIR=1 should fire regardless of debounced state");
    }

    @Test
    void inactivityAlertGatedToDayHours() {
        PresenceFogNode node = new PresenceFogNode();
        node.onReading(pir(1, NIGHT_TS));
        for (int i = 0; i < 20; i++) {
            List<Map<String, Object>> events = node.onReading(pir(0, NIGHT_TS));
            assertTrue(events.stream().noneMatch(e -> "inactivity_alert".equals(e.get("type"))),
                    "must not fire outside 07:00-22:00");
        }
    }

    @Test
    void inactivityAlertDoesNotRepeatUntilCounterResetAndReachesThresholdAgain() {
        PresenceFogNode node = new PresenceFogNode();
        for (int i = 0; i < 20; i++) {
            node.onReading(pir(0, DAY_TS));
        }
        int firstBatchAlerts = 0;
        for (int i = 0; i < 5; i++) {
            firstBatchAlerts += (int) node.onReading(pir(0, DAY_TS)).stream()
                    .filter(e -> "inactivity_alert".equals(e.get("type"))).count();
        }
        assertEquals(0, firstBatchAlerts, "already fired once; must not repeat while still inactive");

        node.onReading(pir(1, DAY_TS)); // resets the counter
        int secondBatchAlerts = 0;
        for (int i = 0; i < 19; i++) {
            secondBatchAlerts += (int) node.onReading(pir(0, DAY_TS)).stream()
                    .filter(e -> "inactivity_alert".equals(e.get("type"))).count();
        }
        assertEquals(0, secondBatchAlerts);
        long finalAlert = node.onReading(pir(0, DAY_TS)).stream()
                .filter(e -> "inactivity_alert".equals(e.get("type"))).count();
        assertEquals(1, finalAlert, "reaching 20 again after reset should fire once more");
    }

    @Test
    void comfortChecksOnlyEvaluatedWhileOccupied() {
        PresenceFogNode node = new PresenceFogNode();
        // Not yet occupied: an out-of-band reading must not dispatch a comfort_event.
        List<Map<String, Object>> events = node.onReading(ambientTemp(30.0, DAY_TS));
        assertTrue(events.isEmpty());

        occupyResident(node);
        List<Map<String, Object>> occupiedEvents = node.onReading(ambientTemp(30.0, DAY_TS));
        assertEquals(1, occupiedEvents.size());
        assertEquals("comfort_event", occupiedEvents.get(0).get("type"));
        assertEquals("temperature", occupiedEvents.get(0).get("issue"));
    }

    @Test
    void comfortEventDispatchesOnlyOnEnteringOutOfBandNotEveryReadingWhileOutOfBand() {
        PresenceFogNode node = new PresenceFogNode();
        occupyResident(node);

        List<Map<String, Object>> first = node.onReading(ambientTemp(30.0, DAY_TS));
        assertEquals(1, first.size());

        List<Map<String, Object>> repeated = node.onReading(ambientTemp(31.0, DAY_TS));
        assertTrue(repeated.isEmpty(), "still out of band: must not re-dispatch every reading");

        List<Map<String, Object>> backInBand = node.onReading(ambientTemp(22.0, DAY_TS));
        assertTrue(backInBand.isEmpty());

        List<Map<String, Object>> outAgain = node.onReading(ambientTemp(30.0, DAY_TS));
        assertEquals(1, outAgain.size(), "re-entering out-of-band should dispatch again");
    }

    @Test
    void airQualityAboveThresholdDispatchesComfortEventWhileOccupied() {
        PresenceFogNode node = new PresenceFogNode();
        occupyResident(node);
        List<Map<String, Object>> events = node.onReading(airQuality(1600, DAY_TS));
        assertEquals(1, events.size());
        assertEquals("air_quality", events.get(0).get("issue"));
    }

    private void occupyResident(PresenceFogNode node) {
        node.onReading(pir(1, DAY_TS));
        node.onReading(pir(1, DAY_TS));
        node.onReading(pir(1, DAY_TS));
    }
}
