package edu.msc.floodwatch.fog.meteo;

import edu.msc.floodwatch.fog.hydro.HydroFogNode;
import org.junit.jupiter.api.Test;

import java.util.HashMap;
import java.util.List;
import java.util.Map;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertTrue;

class MeteoFogNodeTest {

    private static Map<String, Object> pressure(String reachId, double value) {
        Map<String, Object> r = new HashMap<>();
        r.put("reachId", reachId);
        r.put("metric", "barometric-pressure");
        r.put("value", value);
        r.put("unit", "hPa");
        r.put("timestamp", "2026-01-01T00:00:00Z");
        return r;
    }

    private static Map<String, Object> rainfall(String reachId, double value) {
        Map<String, Object> r = new HashMap<>();
        r.put("reachId", reachId);
        r.put("metric", "rainfall");
        r.put("value", value);
        r.put("unit", "mm/h");
        r.put("timestamp", "2026-01-01T00:00:00Z");
        return r;
    }

    @Test
    void pressureSlopeIsNegativeForFallingPressureSeries() {
        CatchmentCorrelator correlator = new CatchmentCorrelator();
        MeteoFogNode node = new MeteoFogNode("reach-upper", correlator, new HydroFogNode());

        // slope of -1 hPa/sample is well past the -0.5 pre-storm threshold from the 2nd sample onward,
        // so the false->true transition dispatch happens as soon as the window has 2 points
        List<Map<String, Object>> firstEvents = node.onReading(pressure("reach-upper", 1020));
        assertTrue(firstEvents.isEmpty());

        List<Map<String, Object>> secondEvents = node.onReading(pressure("reach-upper", 1019));
        assertEquals(1, secondEvents.size());
        assertTrue((double) secondEvents.get(0).get("pressureSlope") < 0);
        assertTrue((Boolean) secondEvents.get(0).get("preStormSignal"));

        // further falling samples keep the signal active but are not a new transition -> no more dispatches
        double[] moreFalling = {1018, 1017, 1016, 1015, 1014, 1013};
        for (double p : moreFalling) {
            assertTrue(node.onReading(pressure("reach-upper", p)).isEmpty());
        }
    }

    @Test
    void pressureSlopeIsPositiveForRisingPressureSeriesAndNoPreStormSignal() {
        CatchmentCorrelator correlator = new CatchmentCorrelator();
        MeteoFogNode node = new MeteoFogNode("reach-upper", correlator, new HydroFogNode());

        double[] risingSeries = {1000, 1001, 1002, 1003};
        List<Map<String, Object>> lastEvents = List.of();
        for (double p : risingSeries) {
            lastEvents = node.onReading(pressure("reach-upper", p));
        }

        // no transition happened (starts and stays false) -> no dispatch
        assertTrue(lastEvents.isEmpty());
    }

    @Test
    void shouldEscalateFalseOnRainfallAloneAcross3ReachesWithNoPressureSignal() {
        CatchmentCorrelator correlator = new CatchmentCorrelator();
        correlator.updateRainfall("reach-upper", 20.0);
        correlator.updateRainfall("reach-mid", 20.0);
        correlator.updateRainfall("reach-lower", 20.0);

        assertFalse(correlator.shouldEscalate());
    }

    @Test
    void shouldEscalateTrueOncePressureSignalJoinsHeavyRainfallOn2Reaches() {
        CatchmentCorrelator correlator = new CatchmentCorrelator();
        correlator.updateRainfall("reach-upper", 20.0);
        correlator.updateRainfall("reach-mid", 20.0);
        correlator.updateRainfall("reach-lower", 5.0);

        assertFalse(correlator.shouldEscalate());

        correlator.updatePreStormSignal("reach-lower", true);
        assertTrue(correlator.shouldEscalate());
    }

    @Test
    void shouldEscalateFalseWithOnly1ReachHeavyRainfallEvenWithPressureSignal() {
        CatchmentCorrelator correlator = new CatchmentCorrelator();
        correlator.updateRainfall("reach-upper", 20.0);
        correlator.updateRainfall("reach-mid", 5.0);
        correlator.updateRainfall("reach-lower", 5.0);
        correlator.updatePreStormSignal("reach-upper", true);

        assertFalse(correlator.shouldEscalate());
    }

    @Test
    void escalationTransitionCallsApplyCrossReachEscalationOnOwnReachHydroFogNode() {
        CatchmentCorrelator correlator = new CatchmentCorrelator();
        HydroFogNode hydroFogNode = new HydroFogNode();
        MeteoFogNode meteoNode = new MeteoFogNode("reach-upper", correlator, hydroFogNode);

        // establish baseline GREEN stage on the hydro node so we can observe the forced escalation
        Map<String, Object> riverLevelReading = new HashMap<>();
        riverLevelReading.put("reachId", "reach-upper");
        riverLevelReading.put("metric", "river-level");
        riverLevelReading.put("value", 1.0);
        riverLevelReading.put("unit", "m");
        riverLevelReading.put("timestamp", "2026-01-01T00:00:00Z");
        hydroFogNode.onReading(riverLevelReading);

        // 2 of 3 reaches heavy rainfall, satisfied directly on the shared correlator
        correlator.updateRainfall("reach-mid", 20.0);
        correlator.updateRainfall("reach-lower", 20.0);

        // drive this reach's own rainfall through MeteoFogNode; still no pre-storm signal -> no escalation yet
        List<Map<String, Object>> noEscalationYet = meteoNode.onReading(rainfall("reach-upper", 20.0));
        assertTrue(noEscalationYet.isEmpty());

        // now push a falling pressure series through this reach's MeteoFogNode to arm the pre-storm signal,
        // which should newly flip shouldEscalate() to true and trigger cross-reach escalation; the slope
        // crosses the threshold as soon as the window has 2 points, so capture the first non-empty result
        double[] fallingSeries = {1020, 1019, 1018, 1017, 1016, 1015, 1014, 1013};
        List<Map<String, Object>> escalationEvents = List.of();
        for (double p : fallingSeries) {
            List<Map<String, Object>> events = meteoNode.onReading(pressure("reach-upper", p));
            if (!events.isEmpty()) {
                escalationEvents = events;
                break;
            }
        }

        assertEquals(1, escalationEvents.size());
        assertTrue((Boolean) escalationEvents.get(0).get("preWarnEscalation"));

        // the shared HydroFogNode reference for this reach should now report the forced escalation
        List<Map<String, Object>> hydroEvents = hydroFogNode.onReading(riverLevelReading);
        assertEquals(1, hydroEvents.size());
        assertEquals("AMBER", hydroEvents.get(0).get("stage"));
        assertTrue((Boolean) hydroEvents.get(0).get("crossReachEscalated"));
    }

    @Test
    void preWarnEscalationDoesNotRefireOnSubsequentTicksWhileStillTrue() {
        CatchmentCorrelator correlator = new CatchmentCorrelator();
        HydroFogNode hydroFogNode = new HydroFogNode();
        MeteoFogNode meteoNode = new MeteoFogNode("reach-upper", correlator, hydroFogNode);

        correlator.updateRainfall("reach-mid", 20.0);
        correlator.updateRainfall("reach-lower", 20.0);
        meteoNode.onReading(rainfall("reach-upper", 20.0));

        double[] fallingSeries = {1020, 1019, 1018, 1017, 1016, 1015, 1014, 1013};
        for (double p : fallingSeries) {
            meteoNode.onReading(pressure("reach-upper", p));
        }

        // pressure keeps falling; shouldEscalate() stays true (not a new transition) -> no repeat preWarnEscalation,
        // but pressure keeps changing so a plain signal event could still be empty since signal was already active
        List<Map<String, Object>> events = meteoNode.onReading(pressure("reach-upper", 1012));
        boolean anyPreWarn = events.stream().anyMatch(e -> Boolean.TRUE.equals(e.get("preWarnEscalation")));
        assertFalse(anyPreWarn);
    }
}
