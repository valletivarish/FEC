package edu.msc.floodwatch.fog.hydro;

import org.junit.jupiter.api.Test;

import java.util.HashMap;
import java.util.List;
import java.util.Map;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertTrue;

class HydroFogNodeTest {

    private static Map<String, Object> riverLevel(String reachId, double value) {
        Map<String, Object> reading = new HashMap<>();
        reading.put("reachId", reachId);
        reading.put("metric", "river-level");
        reading.put("value", value);
        reading.put("unit", "m");
        reading.put("timestamp", "2026-01-01T00:00:00Z");
        return reading;
    }

    private static Map<String, Object> soilSaturation(String reachId, double value) {
        Map<String, Object> reading = new HashMap<>();
        reading.put("reachId", reachId);
        reading.put("metric", "soil-saturation");
        reading.put("value", value);
        reading.put("unit", "%VWC");
        reading.put("timestamp", "2026-01-01T00:00:00Z");
        return reading;
    }

    private static Map<String, Object> flowRate(String reachId, double value) {
        Map<String, Object> reading = new HashMap<>();
        reading.put("reachId", reachId);
        reading.put("metric", "flow-rate");
        reading.put("value", value);
        reading.put("unit", "m3/s");
        reading.put("timestamp", "2026-01-01T00:00:00Z");
        return reading;
    }

    @Test
    void firstReadingBelowAmberIsGreenAndDispatchesOnTransitionFromNoPriorStage() {
        HydroFogNode node = new HydroFogNode();
        List<Map<String, Object>> events = node.onReading(riverLevel("reach-upper", 1.0));

        assertEquals(1, events.size());
        assertEquals("GREEN", events.get(0).get("stage"));
        assertFalse((Boolean) events.get(0).get("soilSaturationAmplified"));
    }

    @Test
    void unamplifiedThresholdsClassifyAmberAt3AndRedAbove5() {
        HydroFogNode node = new HydroFogNode();
        node.onReading(riverLevel("reach-upper", 1.0)); // GREEN baseline

        List<Map<String, Object>> amberEvents = node.onReading(riverLevel("reach-upper", 3.0));
        assertEquals(1, amberEvents.size());
        assertEquals("AMBER", amberEvents.get(0).get("stage"));

        List<Map<String, Object>> redEvents = node.onReading(riverLevel("reach-upper", 5.1));
        assertEquals(1, redEvents.size());
        assertEquals("RED", redEvents.get(0).get("stage"));
    }

    @Test
    void atExactlyRedThresholdStaysAmberSinceRedRequiresStrictlyAbove() {
        HydroFogNode node = new HydroFogNode();
        node.onReading(riverLevel("reach-upper", 3.0)); // GREEN->AMBER transition

        // 5.0 == RED threshold boundary; RED requires strictly above, and AMBER->AMBER is not
        // a transition, so no dispatch is expected here (cadence dispatch not yet due either)
        List<Map<String, Object>> events = node.onReading(riverLevel("reach-upper", 5.0));
        assertTrue(events.isEmpty());
    }

    @Test
    void saturatedSoilShiftsAmberThresholdDownTo2point5() {
        HydroFogNode node = new HydroFogNode();
        node.onReading(soilSaturation("reach-upper", 90.0));

        List<Map<String, Object>> events = node.onReading(riverLevel("reach-upper", 2.6));
        assertEquals(1, events.size());
        assertEquals("AMBER", events.get(0).get("stage"));
        assertTrue((Boolean) events.get(0).get("soilSaturationAmplified"));
    }

    @Test
    void saturatedSoilBelow2point5StillGreen() {
        HydroFogNode node = new HydroFogNode();
        node.onReading(soilSaturation("reach-upper", 90.0));

        List<Map<String, Object>> events = node.onReading(riverLevel("reach-upper", 2.0));
        assertEquals(1, events.size());
        assertEquals("GREEN", events.get(0).get("stage"));
    }

    @Test
    void saturatedSoilShiftsRedThresholdDownTo4point5() {
        HydroFogNode node = new HydroFogNode();
        node.onReading(soilSaturation("reach-upper", 90.0));
        node.onReading(riverLevel("reach-upper", 2.6)); // AMBER baseline

        List<Map<String, Object>> events = node.onReading(riverLevel("reach-upper", 4.6));
        assertEquals(1, events.size());
        assertEquals("RED", events.get(0).get("stage"));
    }

    @Test
    void unsaturatedSoilAtExactly85DoesNotAmplify() {
        HydroFogNode node = new HydroFogNode();
        node.onReading(soilSaturation("reach-upper", 85.0));

        List<Map<String, Object>> events = node.onReading(riverLevel("reach-upper", 2.6));
        assertEquals(1, events.size());
        assertEquals("GREEN", events.get(0).get("stage"));
        assertFalse((Boolean) events.get(0).get("soilSaturationAmplified"));
    }

    @Test
    void crossReachEscalationForcesStageOneLevelHigher() {
        HydroFogNode node = new HydroFogNode();
        node.onReading(riverLevel("reach-upper", 1.0)); // GREEN baseline, dispatched

        node.applyCrossReachEscalation("catchment storm pattern");

        List<Map<String, Object>> events = node.onReading(riverLevel("reach-upper", 1.0)); // still naturally GREEN
        assertEquals(1, events.size());
        assertEquals("AMBER", events.get(0).get("stage"));
        assertTrue((Boolean) events.get(0).get("crossReachEscalated"));
    }

    @Test
    void escalationAutoExpiresAfter4SubsequentTicksIfNotConfirmed() {
        HydroFogNode node = new HydroFogNode();
        node.onReading(riverLevel("reach-upper", 1.0)); // GREEN baseline, cadence tick 1

        node.applyCrossReachEscalation("catchment storm pattern");

        // escalation tick A (cadence tick 2): forced AMBER, transition dispatch
        List<Map<String, Object>> tickA = node.onReading(riverLevel("reach-upper", 1.0));
        assertEquals("AMBER", tickA.get(0).get("stage"));

        // escalation tick B (cadence tick 3): still forced AMBER, no transition, cadence not due
        assertTrue(node.onReading(riverLevel("reach-upper", 1.0)).isEmpty());

        // escalation tick C (cadence tick 4): still forced AMBER, cadence dispatch fires
        List<Map<String, Object>> tickC = node.onReading(riverLevel("reach-upper", 1.0));
        assertEquals(1, tickC.size());
        assertEquals("AMBER", tickC.get(0).get("stage"));

        // escalation tick D (cadence tick 5): 4th subsequent tick since arming, still forced AMBER
        assertTrue(node.onReading(riverLevel("reach-upper", 1.0)).isEmpty());

        // escalation window (4 ticks: A-D) has now expired, naturally GREEN again -> transition dispatch
        List<Map<String, Object>> afterExpiry = node.onReading(riverLevel("reach-upper", 1.0));
        assertEquals(1, afterExpiry.size());
        assertEquals("GREEN", afterExpiry.get(0).get("stage"));
        assertFalse((Boolean) afterExpiry.get(0).get("crossReachEscalated"));
    }

    @Test
    void escalationConfirmedByRealThresholdCrossingToRedStopsForcing() {
        HydroFogNode node = new HydroFogNode();
        node.onReading(riverLevel("reach-upper", 1.0)); // GREEN baseline

        node.applyCrossReachEscalation("catchment storm pattern");
        node.onReading(riverLevel("reach-upper", 1.0)); // forced AMBER (GREEN->AMBER escalated)

        // real crossing to RED on its own: escalateOnce(RED) == RED, so nothing left to force
        List<Map<String, Object>> events = node.onReading(riverLevel("reach-upper", 5.1));
        assertEquals("RED", events.get(0).get("stage"));
        assertFalse((Boolean) events.get(0).get("crossReachEscalated"));

        // escalation is fully cleared now; a later drop back to GREEN is a plain natural transition
        List<Map<String, Object>> afterClear = node.onReading(riverLevel("reach-upper", 1.0));
        assertEquals("GREEN", afterClear.get(0).get("stage"));
        assertFalse((Boolean) afterClear.get(0).get("crossReachEscalated"));
    }

    @Test
    void dispatchesOnEvery4thTickOnceAmberOrRedEvenWithoutTransition() {
        HydroFogNode node = new HydroFogNode();
        node.onReading(riverLevel("reach-upper", 3.5)); // GREEN->AMBER transition, tick 1

        assertTrue(node.onReading(riverLevel("reach-upper", 3.5)).isEmpty()); // tick 2, no transition
        assertTrue(node.onReading(riverLevel("reach-upper", 3.5)).isEmpty()); // tick 3, no transition

        List<Map<String, Object>> tick4 = node.onReading(riverLevel("reach-upper", 3.5)); // tick 4, cadence dispatch
        assertEquals(1, tick4.size());
        assertEquals("AMBER", tick4.get(0).get("stage"));

        assertTrue(node.onReading(riverLevel("reach-upper", 3.5)).isEmpty()); // tick 5
    }

    @Test
    void noDispatchWhileGreenAndNoTransition() {
        HydroFogNode node = new HydroFogNode();
        node.onReading(riverLevel("reach-upper", 1.0)); // GREEN baseline, transition dispatch

        for (int i = 0; i < 6; i++) {
            assertTrue(node.onReading(riverLevel("reach-upper", 1.0 + i * 0.01)).isEmpty());
        }
    }

    @Test
    void reachesAreTrackedIndependently() {
        HydroFogNode node = new HydroFogNode();
        List<Map<String, Object>> upperEvents = node.onReading(riverLevel("reach-upper", 6.0));
        List<Map<String, Object>> midEvents = node.onReading(riverLevel("reach-mid", 1.0));

        assertEquals("RED", upperEvents.get(0).get("stage"));
        assertEquals("GREEN", midEvents.get(0).get("stage"));
    }

    @Test
    void flowRateReadingAloneProducesNoEventAndDoesNotFlagBlockageWithoutHistory() {
        HydroFogNode node = new HydroFogNode();
        List<Map<String, Object>> flowEvents = node.onReading(flowRate("reach-upper", 200.0));
        assertTrue(flowEvents.isEmpty());

        // only one flow-rate sample so far: not enough history to judge a slope, no false flag
        List<Map<String, Object>> events = node.onReading(riverLevel("reach-upper", 1.0));
        assertEquals(1, events.size());
        assertFalse((Boolean) events.get(0).get("blockageSuspected"));
    }

    @Test
    void risingLevelWithFlatFlowRateFlagsBlockageSuspected() {
        HydroFogNode node = new HydroFogNode();
        node.onReading(flowRate("reach-upper", 200.0));
        node.onReading(flowRate("reach-upper", 200.2));
        node.onReading(flowRate("reach-upper", 199.9));

        node.onReading(riverLevel("reach-upper", 1.0));
        node.onReading(riverLevel("reach-upper", 1.5));
        List<Map<String, Object>> events = node.onReading(riverLevel("reach-upper", 2.0));

        assertTrue((Boolean) events.get(0).get("blockageSuspected"));
        assertTrue(events.get(0).containsKey("flowRateSlope"));
    }

    @Test
    void risingLevelWithRisingFlowRateDoesNotFlagBlockage() {
        HydroFogNode node = new HydroFogNode();
        node.onReading(flowRate("reach-upper", 100.0));
        node.onReading(flowRate("reach-upper", 140.0));
        node.onReading(flowRate("reach-upper", 180.0));

        node.onReading(riverLevel("reach-upper", 1.0)); // GREEN baseline, transition dispatch
        // GREEN->AMBER transition guarantees a dispatch here independent of the blockage flag
        List<Map<String, Object>> events = node.onReading(riverLevel("reach-upper", 3.5));

        assertEquals(1, events.size());
        assertFalse((Boolean) events.get(0).get("blockageSuspected"));
    }

    @Test
    void blockageSuspectedForcesDispatchEvenWithoutStageTransitionOrCadence() {
        HydroFogNode node = new HydroFogNode();
        node.onReading(riverLevel("reach-upper", 1.0)); // GREEN baseline, transition dispatch, tick 1

        node.onReading(flowRate("reach-upper", 200.0));
        node.onReading(flowRate("reach-upper", 200.1));

        // still GREEN (no transition) and tick 2 (no cadence due), but blockage should still fire
        List<Map<String, Object>> events = node.onReading(riverLevel("reach-upper", 1.05));
        assertEquals(1, events.size());
        assertTrue((Boolean) events.get(0).get("blockageSuspected"));
        assertEquals("GREEN", events.get(0).get("stage"));
    }
}
