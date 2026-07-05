package binsight.fog.fleet;

import binsight.fog.model.SensorReading;
import org.junit.jupiter.api.Test;

import java.time.Instant;
import java.util.HashMap;
import java.util.List;
import java.util.Map;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertTrue;

class FleetNodeTest {

    private static final String T0 = "2026-01-01T00:00:00Z";

    private Map<String, double[]> binLocations() {
        Map<String, double[]> locations = new HashMap<>();
        locations.put("bin-01", new double[] {53.3498, -6.2603});
        locations.put("bin-02", new double[] {53.3521, -6.2664});
        locations.put("bin-03", new double[] {53.3462, -6.2551});
        return locations;
    }

    private Map<String, Long> freshCollectionTimestamps(long asOfMillis) {
        Map<String, Long> timestamps = new HashMap<>();
        timestamps.put("bin-01", asOfMillis);
        timestamps.put("bin-02", asOfMillis);
        timestamps.put("bin-03", asOfMillis);
        return timestamps;
    }

    private SensorReading gpsReading(String truckId, double lat, double lon, double headingDeg, String timestamp) {
        Map<String, Object> value = new HashMap<>();
        value.put("lat", lat);
        value.put("lon", lon);
        value.put("headingDeg", headingDeg);
        return new SensorReading(truckId, "truck", "truck-gps", value, "obj", timestamp);
    }

    private SensorReading numericReading(String entityId, String type, String metric, double value, String timestamp) {
        return new SensorReading(entityId, type, metric, value, "unit", timestamp);
    }

    // --- GPS decimation ---

    @Test
    void gpsDecimation_firstReadingAlwaysRecords() {
        FleetNode node = new FleetNode(binLocations(), freshCollectionTimestamps(Instant.parse(T0).toEpochMilli()));
        int ticksUsed = 0;
        node.onReading(gpsReading("truck-01", 53.35, -6.26, 90, T0));
        ticksUsed++;
        List<Map<String, Object>> events = dispatchWorkList(node, ticksUsed);
        List<Map<String, Object>> items = itemsOf(events.get(0));
        assertEquals("truck-01", items.get(0).get("assignedTruckId"));
    }

    @Test
    void gpsDecimation_distanceOnlyTrigger_recordsWhenFarEnoughEvenWithSameHeadingAndLowTick() {
        FleetNode node = new FleetNode(binLocations(), freshCollectionTimestamps(Instant.parse(T0).toEpochMilli()));
        int ticksUsed = 0;
        // Initial record far from bin-01 (origin).
        node.onReading(gpsReading("truck-01", 0.0, 0.0, 90, T0));
        ticksUsed++;
        // A rival truck also parked at the origin -- if truck-01's next move is NOT recorded (bug),
        // both trucks tie at the origin and nearest-neighbour would arbitrarily still be well-defined,
        // so instead park truck-02 far in the OPPOSITE direction from bin-01 to disambiguate.
        node.onReading(gpsReading("truck-02", -1.0, -1.0, 0, T0));
        ticksUsed++;
        // ~1113m move (>> 50m threshold) straight to bin-01's location, same heading, tick would be 1 (< 5)
        // -- only the distance trigger can explain a record here.
        node.onReading(gpsReading("truck-01", 53.3498, -6.2603, 90, T0));
        ticksUsed++;

        List<Map<String, Object>> events = dispatchWorkList(node, ticksUsed);
        List<Map<String, Object>> items = itemsOf(events.get(0));
        assertEquals("truck-01", items.get(0).get("assignedTruckId"));
    }

    @Test
    void gpsDecimation_headingOnlyTrigger_recordsDespiteSubThresholdMove() {
        FleetNode node = new FleetNode(binLocations(), freshCollectionTimestamps(Instant.parse(T0).toEpochMilli()));
        int ticksUsed = 0;
        // Initial record far from bin-01 (origin).
        node.onReading(gpsReading("truck-01", 0.0, 0.0, 10, T0));
        ticksUsed++;
        node.onReading(gpsReading("truck-02", -1.0, -1.0, 0, T0));
        ticksUsed++;
        // Move to bin-01's exact location (so the record IS visible via nearest-neighbour if it happens),
        // combined with a 40-degree heading jump (>= 30 threshold); tick counter would only be 1 (< 5),
        // so only the heading trigger can explain a record here.
        node.onReading(gpsReading("truck-01", 53.3498, -6.2603, 50, T0));
        ticksUsed++;

        List<Map<String, Object>> events = dispatchWorkList(node, ticksUsed);
        List<Map<String, Object>> items = itemsOf(events.get(0));
        assertEquals("truck-01", items.get(0).get("assignedTruckId"));
    }

    @Test
    void gpsDecimation_tickTimeoutTrigger_recordsOnFifthReadingDespiteNoMovement() {
        FleetNode node = new FleetNode(binLocations(), freshCollectionTimestamps(Instant.parse(T0).toEpochMilli()));
        int ticksUsed = 0;
        // Initial record far from bin-01 (origin).
        node.onReading(gpsReading("truck-01", 0.0, 0.0, 90, T0));
        ticksUsed++;
        node.onReading(gpsReading("truck-02", -1.0, -1.0, 0, T0));
        ticksUsed++;
        // 4 more sub-threshold readings (distance ~0, heading delta 0) bring the tick counter to 4 on
        // the 4th, then the 5th reaching 5 triggers the timeout record -- moved to bin-01's location so
        // the record is observable, but the move/heading deltas alone are both below their thresholds.
        for (int i = 0; i < 4; i++) {
            node.onReading(gpsReading("truck-01", 0.0, 0.0, 90, T0));
            ticksUsed++;
        }
        node.onReading(gpsReading("truck-01", 53.3498, -6.2603, 90, T0));
        ticksUsed++;

        List<Map<String, Object>> events = dispatchWorkList(node, ticksUsed);
        List<Map<String, Object>> items = itemsOf(events.get(0));
        assertEquals("truck-01", items.get(0).get("assignedTruckId"));
    }

    @Test
    void gpsDecimation_subThresholdMove_doesNotRecord_beforeTickTimeout() {
        FleetNode node = new FleetNode(binLocations(), freshCollectionTimestamps(Instant.parse(T0).toEpochMilli()));
        int ticksUsed = 0;
        node.onReading(gpsReading("truck-01", 0.0, 0.0, 0, T0)); // record at origin (far from bin-01)
        ticksUsed++;
        node.onReading(gpsReading("truck-02", 53.3498, -6.2603, 0, T0)); // rival truck sitting AT bin-01
        ticksUsed++;
        // Tiny move (~4.5m, well under 50m) and 1-degree heading delta (well under 30deg), tick becomes 1 (< 5)
        // -- none of the three triggers fire, so truck-01's recorded position should stay at the origin.
        node.onReading(gpsReading("truck-01", 0.00004, 0.0, 1, T0));
        ticksUsed++;

        List<Map<String, Object>> events = dispatchWorkList(node, ticksUsed);
        List<Map<String, Object>> items = itemsOf(events.get(0));
        // truck-01's position was never updated past the far-away origin, so truck-02 (sitting at bin-01) wins.
        assertEquals("truck-02", items.get(0).get("assignedTruckId"));
    }

    private List<Map<String, Object>> itemsOf(Map<String, Object> workListEvent) {
        return (List<Map<String, Object>>) workListEvent.get("items");
    }

    // Adds a fill-level reading for bin-01 (so it appears in the work-list) and drives remaining
    // ticks up to the next multiple of 10, returning that tick's dispatch.
    private List<Map<String, Object>> dispatchWorkList(FleetNode node, int ticksAlreadyUsed) {
        node.onReading(numericReading("bin-01", "bin", "fill-level", 90, T0));
        int used = ticksAlreadyUsed + 1;
        int remaining = (10 - (used % 10)) % 10;
        List<Map<String, Object>> lastEvents = List.of();
        for (int i = 0; i < remaining; i++) {
            lastEvents = node.onReading(numericReading("truck-03", "truck", "fuel-level", 80, T0));
        }
        return lastEvents;
    }

    // --- Due reasons + priority score ---

    @Test
    void dueReasons_highFillOnly() {
        long now = Instant.parse(T0).toEpochMilli();
        Map<String, Long> collected = freshCollectionTimestamps(now); // hoursSinceCollection ~= 0
        FleetNode node = new FleetNode(binLocations(), collected);

        List<Map<String, Object>> events = dispatchAfterFill(node, "bin-01", 85);
        Map<String, Object> item = findItem(events, "bin-01");
        assertEquals(List.of("HIGH_FILL"), item.get("dueReasons"));
        // safetyWeight=0, fillWeight=0.85, daysOverdue=0 -> priorityScore = 0 + 0.85 + 0 = 0.85
        assertEquals(0.85, (Double) item.get("priorityScore"), 1e-6);
    }

    @Test
    void dueReasons_overdueOnly() {
        long now = Instant.parse(T0).toEpochMilli();
        Map<String, Long> collected = new HashMap<>();
        collected.put("bin-01", now - (100L * 3600_000L)); // 100h ago > 72h -> OVERDUE
        collected.put("bin-02", now);
        collected.put("bin-03", now);
        FleetNode node = new FleetNode(binLocations(), collected);

        List<Map<String, Object>> events = dispatchAfterFill(node, "bin-01", 10); // low fill, not HIGH_FILL
        Map<String, Object> item = findItem(events, "bin-01");
        assertEquals(List.of("OVERDUE"), item.get("dueReasons"));
        // hoursSinceCollection=100 -> daysOverdue = max(0, 100/24 - 3) = max(0, 1.1667) = 1.1667
        // priorityScore = 0 + 0.10 + 1.1667*0.5 = 0.10 + 0.58333 = 0.68333
        assertEquals(0.68333, (Double) item.get("priorityScore"), 1e-4);
    }

    @Test
    void dueReasons_notIncluded_whenNoDueReasonApplies() {
        long now = Instant.parse(T0).toEpochMilli();
        FleetNode node = new FleetNode(binLocations(), freshCollectionTimestamps(now));
        List<Map<String, Object>> events = dispatchAfterFill(node, "bin-01", 10); // low fill, fresh collection, no risk
        boolean present = itemsOf(events.get(0)).stream().anyMatch(i -> i.get("binId").equals("bin-01"));
        assertTrue(!present);
    }

    @Test
    void dueReasons_safetyRisk_watchAndCritical() {
        long now = Instant.parse(T0).toEpochMilli();
        FleetNode node = new FleetNode(binLocations(), freshCollectionTimestamps(now));

        Map<String, Object> watchAlert = new HashMap<>();
        watchAlert.put("binId", "bin-01");
        watchAlert.put("riskStatus", "WATCH");
        watchAlert.put("timestamp", T0);
        node.onBinSafetyAlert(watchAlert); // tick 1 (onBinSafetyAlert also advances the global tick)

        node.onReading(numericReading("bin-01", "bin", "fill-level", 10, T0)); // tick 2
        for (int i = 0; i < 7; i++) {
            node.onReading(numericReading("truck-01", "truck", "fuel-level", 80, T0)); // ticks3-9
        }
        List<Map<String, Object>> events = node.onReading(numericReading("truck-01", "truck", "fuel-level", 80, T0)); // tick10

        Map<String, Object> item = findItem(events, "bin-01");
        assertEquals(List.of("SAFETY_RISK"), item.get("dueReasons"));
        // safetyWeight=1 (WATCH) -> priorityScore = 1*3 + 0.10 + 0 = 3.10
        assertEquals(3.10, (Double) item.get("priorityScore"), 1e-6);
    }

    @Test
    void priorityScore_criticalSafetyWeightIsTwo() {
        long now = Instant.parse(T0).toEpochMilli();
        FleetNode node = new FleetNode(binLocations(), freshCollectionTimestamps(now));

        Map<String, Object> criticalAlert = new HashMap<>();
        criticalAlert.put("binId", "bin-01");
        criticalAlert.put("riskStatus", "CRITICAL");
        criticalAlert.put("timestamp", T0);
        node.onBinSafetyAlert(criticalAlert); // tick 1

        node.onReading(numericReading("bin-01", "bin", "fill-level", 0, T0)); // tick 2
        for (int i = 0; i < 7; i++) {
            node.onReading(numericReading("truck-01", "truck", "fuel-level", 80, T0)); // ticks3-9
        }
        List<Map<String, Object>> events = node.onReading(numericReading("truck-01", "truck", "fuel-level", 80, T0)); // tick10

        Map<String, Object> item = findItem(events, "bin-01");
        // safetyWeight=2 -> priorityScore = 2*3 + 0 + 0 = 6.0
        assertEquals(6.0, (Double) item.get("priorityScore"), 1e-6);
    }

    @Test
    void dataQualityFlag_ridesAlong_withoutAffectingDueReasonsOrScore() {
        long now = Instant.parse(T0).toEpochMilli();
        FleetNode node = new FleetNode(binLocations(), freshCollectionTimestamps(now));

        Map<String, Object> verdict = new HashMap<>();
        verdict.put("binId", "bin-01");
        verdict.put("verdict", "INCONSISTENT");
        verdict.put("timestamp", T0);
        node.onBinClusterVerdict(verdict); // tick 1

        node.onReading(numericReading("bin-01", "bin", "fill-level", 85, T0)); // tick 2
        for (int i = 0; i < 7; i++) {
            node.onReading(numericReading("truck-01", "truck", "fuel-level", 80, T0)); // ticks3-9
        }
        List<Map<String, Object>> events = node.onReading(numericReading("truck-01", "truck", "fuel-level", 80, T0)); // tick10

        Map<String, Object> item = findItem(events, "bin-01");
        assertEquals("INCONSISTENT", item.get("dataQualityFlag"));
        assertEquals(List.of("HIGH_FILL"), item.get("dueReasons"));
        assertEquals(0.85, (Double) item.get("priorityScore"), 1e-6);
    }

    // --- Nearest neighbour + null assignment ---

    @Test
    void nearestNeighbour_assignsClosestTruckAmongMultiple() {
        long now = Instant.parse(T0).toEpochMilli();
        FleetNode node = new FleetNode(binLocations(), freshCollectionTimestamps(now));

        int ticksUsed = 0;
        node.onReading(gpsReading("truck-01", 0.0, 0.0, 0, T0)); // far away
        ticksUsed++;
        node.onReading(gpsReading("truck-02", 53.3498, -6.2603, 0, T0)); // exactly at bin-01
        ticksUsed++;

        List<Map<String, Object>> events = dispatchWorkList(node, ticksUsed);
        Map<String, Object> item = findItem(events, "bin-01");
        assertEquals("truck-02", item.get("assignedTruckId"));
    }

    @Test
    void nullAssignment_whenNoTruckPositionRecordedYet() {
        long now = Instant.parse(T0).toEpochMilli();
        FleetNode node = new FleetNode(binLocations(), freshCollectionTimestamps(now));

        List<Map<String, Object>> events = dispatchAfterFill(node, "bin-01", 85);
        Map<String, Object> item = findItem(events, "bin-01");
        assertNull(item.get("assignedTruckId"));
    }

    // --- Dispatch cadence ---

    @Test
    void dispatchCadence_ticksOneToNineReturnEmpty_tickTenReturnsFullList() {
        long now = Instant.parse(T0).toEpochMilli();
        FleetNode node = new FleetNode(binLocations(), freshCollectionTimestamps(now));

        for (int tick = 1; tick <= 9; tick++) {
            List<Map<String, Object>> events = node.onReading(numericReading("truck-01", "truck", "fuel-level", 80, T0));
            assertTrue(events.isEmpty(), "tick " + tick + " must be empty");
        }
        List<Map<String, Object>> tenth = node.onReading(numericReading("truck-01", "truck", "fuel-level", 80, T0));
        assertEquals(1, tenth.size());
        assertEquals("work_list_event", tenth.get(0).get("type"));
        assertEquals("depot-01", tenth.get(0).get("depotId"));
    }

    @Test
    void dispatchCadence_sortsItemsByPriorityScoreDescending() {
        long now = Instant.parse(T0).toEpochMilli();
        FleetNode node = new FleetNode(binLocations(), freshCollectionTimestamps(now));

        node.onReading(numericReading("bin-01", "bin", "fill-level", 20, T0)); // tick1, low priority
        node.onReading(numericReading("bin-02", "bin", "fill-level", 95, T0)); // tick2, high priority
        node.onReading(numericReading("bin-03", "bin", "fill-level", 60, T0)); // tick3
        for (int i = 0; i < 6; i++) {
            node.onReading(numericReading("truck-01", "truck", "fuel-level", 80, T0)); // ticks4-9
        }
        List<Map<String, Object>> events = node.onReading(numericReading("truck-01", "truck", "fuel-level", 80, T0)); // tick10
        List<Map<String, Object>> items = itemsOf(events.get(0));

        for (int i = 0; i + 1 < items.size(); i++) {
            double a = (Double) items.get(i).get("priorityScore");
            double b = (Double) items.get(i + 1).get("priorityScore");
            assertTrue(a >= b, "items must be sorted descending by priorityScore");
        }
    }

    @Test
    void dispatchCadence_includesLatestWeighbridgeTonnage() {
        long now = Instant.parse(T0).toEpochMilli();
        FleetNode node = new FleetNode(binLocations(), freshCollectionTimestamps(now));

        node.onReading(numericReading("depot-01", "depot", "weighbridge-tonnage", 7.5, T0));
        for (int i = 0; i < 8; i++) {
            node.onReading(numericReading("truck-01", "truck", "fuel-level", 80, T0));
        }
        List<Map<String, Object>> events = node.onReading(numericReading("truck-01", "truck", "fuel-level", 80, T0));
        assertEquals(7.5, (Double) events.get(0).get("latestWeighbridgeTonnage"), 1e-9);
    }

    // truck-gps/hopper-fill/fuel-level otherwise only update internal decimation/priority
    // state and never reach the backend on their own -- this proves they ride along on the
    // work-list event instead, so the dashboard's fleet-readout panel has real data to show.
    @Test
    void dispatchCadence_includesFleetTelemetry_hopperFuelAndPosition() {
        long now = Instant.parse(T0).toEpochMilli();
        FleetNode node = new FleetNode(binLocations(), freshCollectionTimestamps(now));

        node.onReading(gpsReading("truck-01", 53.3498, -6.2603, 90, T0)); // tick1
        node.onReading(numericReading("truck-01", "truck", "hopper-fill", 42.0, T0)); // tick2
        for (int i = 0; i < 7; i++) {
            node.onReading(numericReading("truck-01", "truck", "fuel-level", 88.0, T0)); // ticks3-9
        }
        List<Map<String, Object>> events = node.onReading(numericReading("truck-01", "truck", "fuel-level", 88.0, T0)); // tick10

        Map<String, Object> telemetry = (Map<String, Object>) events.get(0).get("fleetTelemetry");
        assertEquals("truck-01", telemetry.get("truckId"));
        assertEquals(42.0, (Double) telemetry.get("hopperFillPct"), 1e-9);
        assertEquals(88.0, (Double) telemetry.get("fuelLevelPct"), 1e-9);

        Map<String, Object> position = (Map<String, Object>) telemetry.get("lastRecordedPosition");
        assertEquals(53.3498, (Double) position.get("lat"), 1e-9);
        assertEquals(-6.2603, (Double) position.get("lon"), 1e-9);
    }

    @Test
    void fleetTelemetry_absent_whenNoTruckDataRecordedYet() {
        long now = Instant.parse(T0).toEpochMilli();
        FleetNode node = new FleetNode(binLocations(), freshCollectionTimestamps(now));

        // bin-only ticks (weighbridge-tonnage touches no truck map), unlike dispatchAfterFill's
        // truck-01 fuel-level filler ticks, so fleetTelemetry genuinely has nothing to report.
        node.onReading(numericReading("bin-01", "bin", "fill-level", 85, T0)); // tick1
        for (int i = 0; i < 8; i++) {
            node.onReading(numericReading("depot-01", "depot", "weighbridge-tonnage", 5.0, T0)); // ticks2-9
        }
        List<Map<String, Object>> events = node.onReading(
                numericReading("depot-01", "depot", "weighbridge-tonnage", 5.0, T0)); // tick10

        assertTrue(!events.get(0).containsKey("fleetTelemetry"));
    }

    // helper: fills bin-01 fill-level then drives 8 more ticks (total 9), returns tick-10 dispatch
    private List<Map<String, Object>> dispatchAfterFill(FleetNode node, String binId, double fillPct) {
        node.onReading(numericReading(binId, "bin", "fill-level", fillPct, T0)); // tick1
        for (int i = 0; i < 8; i++) {
            node.onReading(numericReading("truck-01", "truck", "fuel-level", 80, T0)); // ticks2-9
        }
        return node.onReading(numericReading("truck-01", "truck", "fuel-level", 80, T0)); // tick10
    }

    private Map<String, Object> findItem(List<Map<String, Object>> events, String binId) {
        return itemsOf(events.get(0)).stream()
                .filter(i -> i.get("binId").equals(binId))
                .findFirst()
                .orElseThrow();
    }
}
