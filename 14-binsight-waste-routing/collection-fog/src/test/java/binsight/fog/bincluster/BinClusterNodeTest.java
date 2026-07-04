package binsight.fog.bincluster;

import binsight.fog.model.SensorReading;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;

import java.util.List;
import java.util.Map;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertTrue;

class BinClusterNodeTest {

    private BinClusterNode node;

    @BeforeEach
    void setUp() {
        node = new BinClusterNode();
    }

    private SensorReading reading(String binId, String metric, Object value) {
        return new SensorReading(binId, "bin", metric, value, "unit", "2026-01-01T00:00:00Z");
    }

    @Test
    void expectedWeightBand_mapsFullFillToFullCapacity() {
        assertEquals(240.0, node.expectedWeightKg(100), 1e-9);
        assertEquals(0.0, node.expectedWeightKg(0), 1e-9);
        assertEquals(120.0, node.expectedWeightKg(50), 1e-9);
        assertEquals(204.0, node.expectedWeightKg(85), 1e-9);
    }

    // The tick counter advances on EVERY onReading call for a bin (fill-level, bin-weight, AND
    // lid-state), so intervening lid-state reads still consume tick slots even though only
    // fill-level/bin-weight readings ever recompute the verdict or check dispatch-worthiness.

    @Test
    void verdict_possibleFalseFull_takesPriorityRegardlessOfLidState() {
        String binId = "bin-01";
        node.onReading(reading(binId, "bin-weight", 5.0)); // tick 1: establish weight
        node.onReading(reading(binId, "lid-state", "OPEN")); // tick 2: establish lid, all 3 known after this fill
        // ticks 3-7 via filler lid-state reads (don't change lid value's meaning, OPEN throughout)
        for (int i = 0; i < 5; i++) {
            node.onReading(reading(binId, "lid-state", "OPEN"));
        }
        // tick 8: fill-level reading triggers dispatch check
        List<Map<String, Object>> events = node.onReading(reading(binId, "fill-level", 90.0));

        assertEquals(1, events.size());
        assertEquals("POSSIBLE_FALSE_FULL", events.get(0).get("verdict"));
    }

    @Test
    void verdict_possibleFalseFull_beatsInconsistentWhenBothConditionsWouldMatch() {
        // fillLevelPct=90 (expected 216kg), weight=5kg with lid CLOSED satisfies BOTH the
        // false-full check and the >35%-off-band inconsistent check; false-full must win.
        String binId = "bin-01";
        node.onReading(reading(binId, "bin-weight", 5.0)); // tick 1
        node.onReading(reading(binId, "lid-state", "CLOSED")); // tick 2
        for (int i = 0; i < 5; i++) {
            node.onReading(reading(binId, "lid-state", "CLOSED")); // ticks 3-7
        }
        List<Map<String, Object>> events = node.onReading(reading(binId, "fill-level", 90.0)); // tick 8

        assertEquals(1, events.size());
        assertEquals("POSSIBLE_FALSE_FULL", events.get(0).get("verdict"));
    }

    @Test
    void verdict_inconsistent_whenLidClosedAndWeightFarFromExpectedBand() {
        // fillLevelPct=50 -> expected 120kg; weight=50kg is 58% off (> 35% threshold), lid CLOSED.
        String binId = "bin-01";
        node.onReading(reading(binId, "bin-weight", 50.0)); // tick 1
        node.onReading(reading(binId, "lid-state", "CLOSED")); // tick 2
        for (int i = 0; i < 5; i++) {
            node.onReading(reading(binId, "lid-state", "CLOSED")); // ticks 3-7
        }
        List<Map<String, Object>> events = node.onReading(reading(binId, "fill-level", 50.0)); // tick 8

        assertEquals(1, events.size());
        assertEquals("INCONSISTENT", events.get(0).get("verdict"));
        assertEquals(120.0, (Double) events.get(0).get("expectedWeightKg"), 1e-9);
    }

    @Test
    void verdict_normal_whenWithinBand_neverDispatchesEvenOnEighthTick() {
        // fillLevelPct=50 -> expected 120kg; weight=110kg is within the 35% band, lid CLOSED -> NORMAL.
        String binId = "bin-01";
        node.onReading(reading(binId, "bin-weight", 110.0)); // tick 1
        node.onReading(reading(binId, "lid-state", "CLOSED")); // tick 2
        for (int i = 0; i < 5; i++) {
            node.onReading(reading(binId, "lid-state", "CLOSED")); // ticks 3-7
        }
        List<Map<String, Object>> events = node.onReading(reading(binId, "fill-level", 50.0)); // tick 8

        assertTrue(events.isEmpty());
    }

    @Test
    void verdict_normal_whenLidNotClosedEvenIfWeightFarOffBand() {
        // Weight far off expected band, but lid OPEN means the INCONSISTENT check never applies -> NORMAL.
        String binId = "bin-01";
        node.onReading(reading(binId, "bin-weight", 5.0)); // tick 1
        node.onReading(reading(binId, "lid-state", "OPEN")); // tick 2
        for (int i = 0; i < 5; i++) {
            node.onReading(reading(binId, "lid-state", "OPEN")); // ticks 3-7
        }
        List<Map<String, Object>> events = node.onReading(reading(binId, "fill-level", 50.0)); // tick 8

        assertTrue(events.isEmpty());
    }

    @Test
    void dispatch_onlyEveryEighthTick_whenVerdictNonNormal() {
        String binId = "bin-01";
        node.onReading(reading(binId, "lid-state", "CLOSED")); // tick 1

        int dispatchCount = 0;
        // ticks 2-17: alternating fill-level/bin-weight readings, always inconsistent (fill=50 -> 120kg
        // expected, weight=50kg far off band, lid CLOSED throughout).
        for (int tick = 2; tick <= 17; tick++) {
            String metric = (tick % 2 == 0) ? "fill-level" : "bin-weight";
            List<Map<String, Object>> events = node.onReading(reading(binId, metric, 50.0));
            if (tick == 8 || tick == 16) {
                assertEquals(1, events.size(), "tick " + tick + " should dispatch (multiple of 8, non-NORMAL)");
                dispatchCount++;
            } else {
                assertTrue(events.isEmpty(), "tick " + tick + " should not dispatch");
            }
        }
        assertEquals(2, dispatchCount);
    }

    @Test
    void doesNotDispatch_untilAllThreeMetricsKnown() {
        List<Map<String, Object>> events = node.onReading(reading("bin-01", "fill-level", 95.0));
        assertTrue(events.isEmpty());
        events = node.onReading(reading("bin-01", "bin-weight", 2.0));
        assertTrue(events.isEmpty()); // lid-state still unknown, even though this is tick 2
    }

    @Test
    void tickCounter_advancesOnLidStateReadingsToo() {
        // Establish all 3 metrics on ticks 1-3, then use 5 lid-state-only ticks (4-8) to reach tick 8
        // without ever re-sending fill-level/bin-weight; tick 8 lands on a lid-state read, so even
        // though the bin would be dispatch-worthy, no dispatch fires because only fill/weight readings
        // trigger a verdict check.
        String binId = "bin-01";
        node.onReading(reading(binId, "fill-level", 90.0)); // tick 1
        node.onReading(reading(binId, "bin-weight", 5.0)); // tick 2, verdict POSSIBLE_FALSE_FULL but tick 2 != 8
        node.onReading(reading(binId, "lid-state", "OPEN")); // tick 3
        List<Map<String, Object>> lastEvents = null;
        for (int i = 0; i < 5; i++) {
            lastEvents = node.onReading(reading(binId, "lid-state", "OPEN")); // ticks 4-8
        }
        assertTrue(lastEvents.isEmpty(), "tick 8 landed on a lid-state reading, which never dispatches");
    }
}
