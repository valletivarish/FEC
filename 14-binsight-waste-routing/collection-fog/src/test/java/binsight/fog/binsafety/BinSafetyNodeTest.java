package binsight.fog.binsafety;

import binsight.fog.model.SensorReading;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;

import java.util.List;
import java.util.Map;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertTrue;

class BinSafetyNodeTest {

    private BinSafetyNode node;

    @BeforeEach
    void setUp() {
        node = new BinSafetyNode();
    }

    private SensorReading reading(String binId, String metric, double value) {
        return new SensorReading(binId, "bin", metric, value, "unit", "2026-01-01T00:00:00Z");
    }

    @Test
    void medianSmoothing_methane_matchesHandComputedReference() {
        String binId = "bin-01";
        // window fills with 100, 500, 300 -> sorted [100, 300, 500] -> median 300.
        node.onReading(reading(binId, "methane-ppm", 100));
        node.onReading(reading(binId, "methane-ppm", 500));
        List<Map<String, Object>> events = node.onReading(reading(binId, "methane-ppm", 300));
        // No dispatch yet since temp median unknown, but we can inspect via a subsequent temp reading.
        node.onReading(reading(binId, "internal-temp", 25));
        node.onReading(reading(binId, "internal-temp", 25));
        events = node.onReading(reading(binId, "internal-temp", 25));
        assertEquals(300.0, (Double) events.get(0).get("medianMethanePpm"), 1e-9);
    }

    @Test
    void medianSmoothing_slidesWindowAndDropsOldestSample() {
        String binId = "bin-01";
        node.onReading(reading(binId, "methane-ppm", 100));
        node.onReading(reading(binId, "methane-ppm", 200));
        node.onReading(reading(binId, "methane-ppm", 300)); // window [100,200,300] -> median 200
        node.onReading(reading(binId, "methane-ppm", 900)); // window slides to [200,300,900] -> median 300

        node.onReading(reading(binId, "internal-temp", 25));
        node.onReading(reading(binId, "internal-temp", 25));
        List<Map<String, Object>> events = node.onReading(reading(binId, "internal-temp", 25));
        assertEquals(300.0, (Double) events.get(0).get("medianMethanePpm"), 1e-9);
    }

    @Test
    void riskScoreFormula_matchesHandComputedReference() {
        // methane=2500 -> min(100, 2500/5000*100)=50 -> 0.5*50=25
        // temp=47.5 -> clamp((47.5-25)/45*100,0,100)=50 -> 0.35*50=17.5
        // tilt=50 (>45) -> 0.15*100=15
        // total = 25 + 17.5 + 15 = 57.5
        double score = node.computeRiskScore(2500, 47.5, 50);
        assertEquals(57.5, score, 1e-9);
    }

    @Test
    void riskScoreFormula_tiltAtOrBelow45ContributesZero() {
        double scoreAt45 = node.computeRiskScore(0, 25, 45);
        assertEquals(0.0, scoreAt45, 1e-9);
        double scoreAt46 = node.computeRiskScore(0, 25, 46);
        assertEquals(15.0, scoreAt46, 1e-9);
    }

    @Test
    void riskScoreFormula_methaneAndTempClampAtUpperBound() {
        // methane way above 5000 clamps the ratio at 100 -> 0.5*100=50
        double methaneComponent = node.computeRiskScore(50000, 25, 0);
        assertEquals(50.0, methaneComponent, 1e-9);
        // temp way above 70 clamps at 100 -> 0.35*100=35
        double tempComponent = node.computeRiskScore(0, 200, 0);
        assertEquals(35.0, tempComponent, 1e-9);
    }

    @Test
    void classify_boundaries() {
        assertEquals("NORMAL", node.classify(39.999));
        assertEquals("WATCH", node.classify(40.0));
        assertEquals("WATCH", node.classify(69.999));
        assertEquals("CRITICAL", node.classify(70.0));
    }

    // Establishes 3-sample medians for methane and temp; the dispatch-worthy classification fires
    // on the 3rd temp reading (the moment both medians first become available), not on any later
    // tilt reading -- tilt only defaults to 0 and doesn't gate dispatch-readiness.
    private List<Map<String, Object>> primeToScore(String binId, double methane, double temp) {
        node.onReading(reading(binId, "methane-ppm", methane));
        node.onReading(reading(binId, "methane-ppm", methane));
        node.onReading(reading(binId, "methane-ppm", methane));
        node.onReading(reading(binId, "internal-temp", temp));
        node.onReading(reading(binId, "internal-temp", temp));
        return node.onReading(reading(binId, "internal-temp", temp));
    }

    @Test
    void dispatch_watchAndNormal_onlyOnStateTransition() {
        String binId = "bin-01";
        // Establish NORMAL first (methane=0, temp=25, tilt defaults to 0 -> score 0).
        List<Map<String, Object>> firstEvents = primeToScore(binId, 0, 25);
        // First-ever classification counts as a transition from "unknown" -> dispatches.
        assertEquals(1, firstEvents.size());
        assertEquals("NORMAL", firstEvents.get(0).get("riskStatus"));

        // Still NORMAL (same score) -> no transition -> no dispatch.
        List<Map<String, Object>> repeatEvents = node.onReading(reading(binId, "tilt", 0));
        assertTrue(repeatEvents.isEmpty());

        // Move into WATCH: window was [0,0,0]; first 4500 reading slides it to [0,0,4500] -> median
        // still 0 (NORMAL, no dispatch since no transition); second 4500 reading slides to
        // [0,4500,4500] -> median 4500 -> component 45; temp stays 25 -> 0; tilt 0 -> total 45 -> WATCH.
        List<Map<String, Object>> stillNormal = node.onReading(reading(binId, "methane-ppm", 4500));
        assertTrue(stillNormal.isEmpty());
        List<Map<String, Object>> transitionEvents = node.onReading(reading(binId, "methane-ppm", 4500));
        assertEquals(1, transitionEvents.size());
        assertEquals("WATCH", transitionEvents.get(0).get("riskStatus"));

        // Still WATCH with an unrelated tilt reading that doesn't change score enough to leave WATCH.
        List<Map<String, Object>> staysWatch = node.onReading(reading(binId, "tilt", 0));
        assertTrue(staysWatch.isEmpty());
    }

    @Test
    void dispatch_critical_firesOnEveryQualifyingReading_notJustFirstTransition() {
        String binId = "bin-01";
        // methane=10000 -> component 50; temp=70 -> component 35; tilt=50 -> component 15. total=100 CRITICAL.
        node.onReading(reading(binId, "methane-ppm", 10000));
        node.onReading(reading(binId, "methane-ppm", 10000));
        node.onReading(reading(binId, "methane-ppm", 10000));
        node.onReading(reading(binId, "internal-temp", 70));
        node.onReading(reading(binId, "internal-temp", 70));
        node.onReading(reading(binId, "internal-temp", 70));
        List<Map<String, Object>> first = node.onReading(reading(binId, "tilt", 50));
        assertEquals(1, first.size());
        assertEquals("CRITICAL", first.get(0).get("riskStatus"));

        // Subsequent readings that keep recomputing a CRITICAL score must ALSO dispatch, unlike WATCH/NORMAL.
        List<Map<String, Object>> second = node.onReading(reading(binId, "tilt", 50));
        assertEquals(1, second.size());
        assertEquals("CRITICAL", second.get(0).get("riskStatus"));

        List<Map<String, Object>> third = node.onReading(reading(binId, "internal-temp", 70));
        assertEquals(1, third.size());
        assertEquals("CRITICAL", third.get(0).get("riskStatus"));
    }

    @Test
    void tiltDefaultsToZero_whenNeverSeen() {
        String binId = "bin-01";
        node.onReading(reading(binId, "methane-ppm", 5000));
        node.onReading(reading(binId, "methane-ppm", 5000));
        List<Map<String, Object>> events = node.onReading(reading(binId, "methane-ppm", 5000));
        // methane component alone: 0.5*100=50; temp median not yet known -> no dispatch at all.
        assertTrue(events.isEmpty());

        node.onReading(reading(binId, "internal-temp", 25));
        node.onReading(reading(binId, "internal-temp", 25));
        List<Map<String, Object>> withTemp = node.onReading(reading(binId, "internal-temp", 25));
        // methane=50 + temp=0 + tilt(default 0)=0 -> score 50 -> WATCH.
        assertEquals(1, withTemp.size());
        assertEquals("WATCH", withTemp.get(0).get("riskStatus"));
        assertEquals(0.0, (Double) withTemp.get(0).get("tiltDegrees"), 1e-9);
    }

    @Test
    void noDispatch_untilBothMethaneAndTempMediansAvailable() {
        String binId = "bin-01";
        List<Map<String, Object>> events = node.onReading(reading(binId, "methane-ppm", 9000));
        assertTrue(events.isEmpty());
        events = node.onReading(reading(binId, "methane-ppm", 9000));
        assertTrue(events.isEmpty());
        events = node.onReading(reading(binId, "tilt", 50));
        assertTrue(events.isEmpty()); // methane window still only has 2 samples, no median yet
    }
}
