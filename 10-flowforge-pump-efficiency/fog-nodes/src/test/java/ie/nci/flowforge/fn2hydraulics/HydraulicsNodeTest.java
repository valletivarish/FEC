package ie.nci.flowforge.fn2hydraulics;

import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;

import java.util.HashMap;
import java.util.List;
import java.util.Map;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertTrue;

class HydraulicsNodeTest {

    private static final String PUMP_ID = "pump-02";

    private HydraulicsNode hydraulicsNode;

    @BeforeEach
    void setUp() {
        hydraulicsNode = new HydraulicsNode();
    }

    private Map<String, Object> reading(String metric, double value) {
        Map<String, Object> r = new HashMap<>();
        r.put("pumpId", PUMP_ID);
        r.put("metric", metric);
        r.put("value", value);
        r.put("timestamp", "2026-01-01T00:00:00Z");
        return r;
    }

    private void primeAllMetricsExceptOutlet(double inlet, double flow, double power, double rpm) {
        hydraulicsNode.onReading(reading("inlet-pressure", inlet));
        hydraulicsNode.onReading(reading("flow-rate", flow));
        hydraulicsNode.onReading(reading("power-draw", power));
        hydraulicsNode.onReading(reading("rpm", rpm));
    }

    @Test
    void efficiencyFormulaMatchesHandComputedReference() {
        // inlet 1.0 bar, outlet 4.0 bar, flow 100 m3/h, power 40 kW, rpm 1500
        // headMeters = 3.0 * 10.19716 = 30.59148; flowM3s = 100/3600 = 0.027778
        // efficiency = (0.027778 * 30.59148 * 1000 * 9.81) / 40000 = 0.208404...
        primeAllMetricsExceptOutlet(1.0, 100.0, 40.0, 1500.0);

        List<Map<String, Object>> events = hydraulicsNode.onReading(reading("outlet-pressure", 4.0));

        // deviation here is large (>20pp) so this also exercises the CRITICAL immediate path;
        // efficiency/predicted values are asserted directly regardless of dispatch severity
        assertEquals(1, events.size());
        double efficiency = (double) events.get(0).get("efficiency");
        double predicted = (double) events.get(0).get("predictedEfficiency");
        assertEquals(0.2084, efficiency, 0.001);
        assertEquals(0.55, predicted, 0.0001);
    }

    @Test
    void affinityLawCurveIsPiecewiseLinearAndClamped() {
        // predictedEfficiency = 0.55 + 0.0001*(rpm-1500), clamped to [0.3, 0.8]
        assertEquals(0.55, predictedEfficiencyAt(1500), 0.0001);
        assertEquals(0.50, predictedEfficiencyAt(1000), 0.0001);
        assertEquals(0.60, predictedEfficiencyAt(2000), 0.0001);
        // far below/above range must clamp rather than go negative or past 0.8
        assertEquals(0.30, predictedEfficiencyAt(-2000), 0.0001);
        assertEquals(0.80, predictedEfficiencyAt(5000), 0.0001);
    }

    private double predictedEfficiencyAt(double rpm) {
        // near-zero head and a huge power draw push efficiency to ~0 for every rpm point tested,
        // so the resulting deviation is always > 20pp (CRITICAL, immediate dispatch, no debounce
        // to worry about) and the event's predictedEfficiency can be read straight off the curve
        HydraulicsNode node = new HydraulicsNode();
        node.onReading(reading("inlet-pressure", 1.0));
        node.onReading(reading("flow-rate", 1.0));
        node.onReading(reading("power-draw", 100000.0));
        node.onReading(reading("rpm", rpm));
        List<Map<String, Object>> events = node.onReading(reading("outlet-pressure", 1.01));
        return (double) events.get(0).get("predictedEfficiency");
    }

    @Test
    void oneOrTwoBreachesAloneDoNotDispatchWarning() {
        // inlet 1.0, outlet 4.5, flow 100, power 25, rpm 1500 -> deviation ~16.1pp (WARNING zone, not CRITICAL)
        primeAllMetricsExceptOutlet(1.0, 100.0, 25.0, 1500.0);

        List<Map<String, Object>> first = hydraulicsNode.onReading(reading("outlet-pressure", 4.5));
        assertTrue(first.isEmpty(), "a single WARNING-zone breach must not dispatch (debounced)");

        primeAllMetricsExceptOutlet(1.0, 100.0, 25.0, 1500.0);
        List<Map<String, Object>> second = hydraulicsNode.onReading(reading("outlet-pressure", 4.5));
        assertTrue(second.isEmpty(), "two consecutive WARNING-zone breaches must still not dispatch");
    }

    @Test
    void thirdConsecutiveBreachDispatchesDebouncedWarning() {
        List<Map<String, Object>> events = List.of();
        for (int i = 0; i < 3; i++) {
            primeAllMetricsExceptOutlet(1.0, 100.0, 25.0, 1500.0);
            events = hydraulicsNode.onReading(reading("outlet-pressure", 4.5));
        }

        assertEquals(1, events.size(), "the 3rd consecutive breach must dispatch a WARNING event");
        assertEquals("hydraulics_event", events.get(0).get("type"));
        assertEquals("WARNING", events.get(0).get("severity"));
    }

    @Test
    void criticalDeviationBypassesDebounceAndFiresOnFirstOccurrence() {
        // inlet 1.0, outlet 4.0, flow 100, power 40, rpm 1500 -> deviation ~34pp (> 20pp CRITICAL threshold)
        primeAllMetricsExceptOutlet(1.0, 100.0, 40.0, 1500.0);

        List<Map<String, Object>> events = hydraulicsNode.onReading(reading("outlet-pressure", 4.0));

        assertEquals(1, events.size(), "CRITICAL deviation must dispatch immediately, no debounce");
        assertEquals("CRITICAL", events.get(0).get("severity"));
        double deviation = (double) events.get(0).get("deviationPercentagePoints");
        assertTrue(deviation > 20.0);
    }

    @Test
    void noEventUntilAllFiveTrackedMetricsAreKnown() {
        // outlet-pressure arrives before the other 4 metrics have ever been seen
        List<Map<String, Object>> events = hydraulicsNode.onReading(reading("outlet-pressure", 4.0));
        assertTrue(events.isEmpty());
    }
}
