package edu.msc.floodwatch.fog;

import edu.msc.floodwatch.fog.common.ReachEventDispatcher;
import edu.msc.floodwatch.fog.hydro.HydroFogNode;
import edu.msc.floodwatch.fog.meteo.CatchmentCorrelator;
import edu.msc.floodwatch.fog.meteo.MeteoFogNode;
import org.junit.jupiter.api.Test;

import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
import java.util.Map;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertTrue;

/**
 * Exercises the fog node classes wired together the way FogRuntimeApp wires them, using a
 * fake dispatcher subclass instead of real HTTP so event shapes can be asserted directly.
 */
class FogNodesWiringTest {

    private static class FakeReachEventDispatcher extends ReachEventDispatcher {
        final List<Map<String, Object>> dispatched = new ArrayList<>();

        FakeReachEventDispatcher() {
            super("http://unused");
        }

        @Override
        public boolean dispatch(Map<String, Object> event) {
            dispatched.add(event);
            return true;
        }
    }

    private static Map<String, Object> reading(String reachId, String metric, double value, String unit) {
        Map<String, Object> r = new HashMap<>();
        r.put("reachId", reachId);
        r.put("metric", metric);
        r.put("value", value);
        r.put("unit", unit);
        r.put("timestamp", "2026-01-01T00:00:00Z");
        return r;
    }

    @Test
    void hydroFogNodeEventsDispatchedThroughFakeDispatcherHaveExpectedShape() {
        FakeReachEventDispatcher dispatcher = new FakeReachEventDispatcher();
        HydroFogNode hydroFogNode = new HydroFogNode();

        for (Map<String, Object> event : hydroFogNode.onReading(reading("reach-lower", "river-level", 6.0, "m"))) {
            dispatcher.dispatch(event);
        }

        assertEquals(1, dispatcher.dispatched.size());
        Map<String, Object> event = dispatcher.dispatched.get(0);
        assertEquals("hydro_event", event.get("type"));
        assertEquals("reach-lower", event.get("reachId"));
        assertEquals("RED", event.get("stage"));
        assertTrue(event.containsKey("riverLevel"));
        assertTrue(event.containsKey("rateOfRise"));
        assertTrue(event.containsKey("soilSaturationAmplified"));
        assertTrue(event.containsKey("crossReachEscalated"));
        assertTrue(event.containsKey("flowRateSlope"));
        assertTrue(event.containsKey("blockageSuspected"));
        assertTrue(event.containsKey("timestamp"));
    }

    @Test
    void meteoFogNodeCrossReachEscalationDispatchesToHydroAndMeteoEventsViaFakeDispatcher() {
        FakeReachEventDispatcher dispatcher = new FakeReachEventDispatcher();
        CatchmentCorrelator correlator = new CatchmentCorrelator();
        HydroFogNode hydroFogNode = new HydroFogNode();
        MeteoFogNode meteoFogNode = new MeteoFogNode("reach-upper", correlator, hydroFogNode);

        for (Map<String, Object> event : hydroFogNode.onReading(reading("reach-upper", "river-level", 1.0, "m"))) {
            dispatcher.dispatch(event);
        }

        correlator.updateRainfall("reach-mid", 20.0);
        correlator.updateRainfall("reach-lower", 20.0);
        for (Map<String, Object> event : meteoFogNode.onReading(reading("reach-upper", "rainfall", 20.0, "mm/h"))) {
            dispatcher.dispatch(event);
        }

        double[] fallingSeries = {1020, 1019, 1018, 1017, 1016, 1015, 1014, 1013};
        for (double p : fallingSeries) {
            for (Map<String, Object> event : meteoFogNode.onReading(reading("reach-upper", "barometric-pressure", p, "hPa"))) {
                dispatcher.dispatch(event);
            }
        }

        boolean sawPreWarnEscalation = dispatcher.dispatched.stream()
                .anyMatch(e -> "meteo_event".equals(e.get("type")) && Boolean.TRUE.equals(e.get("preWarnEscalation")));
        assertTrue(sawPreWarnEscalation);

        for (Map<String, Object> event : hydroFogNode.onReading(reading("reach-upper", "river-level", 1.0, "m"))) {
            dispatcher.dispatch(event);
        }

        boolean sawCrossReachEscalatedHydroEvent = dispatcher.dispatched.stream()
                .anyMatch(e -> "hydro_event".equals(e.get("type")) && Boolean.TRUE.equals(e.get("crossReachEscalated")));
        assertTrue(sawCrossReachEscalatedHydroEvent);
    }
}
