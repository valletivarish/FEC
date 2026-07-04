package edu.msc.floodwatch.fog.quality;

import org.junit.jupiter.api.Test;

import java.util.HashMap;
import java.util.List;
import java.util.Map;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertTrue;

class QualityFogNodeTest {

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
    void cwqiNotComputedUntilTurbidityDissolvedOxygenAndPhAllKnown() {
        QualityFogNode node = new QualityFogNode();
        List<Map<String, Object>> events = node.onReading(reading("reach-mid", "turbidity", 40.0, "NTU"));
        assertTrue(events.isEmpty());

        events = node.onReading(reading("reach-mid", "dissolved-oxygen", 8.0, "mg/L"));
        assertTrue(events.isEmpty());

        // ph is the last of the 3 heaviest-weighted metrics; CWQI now computable -> band dispatch
        events = node.onReading(reading("reach-mid", "ph", 7.2, "pH"));
        assertEquals(1, events.size());
        assertEquals("quality_event", events.get(0).get("type"));
        assertTrue(events.get(0).containsKey("cwqi"));
    }

    @Test
    void cwqiWeightedFormulaMatchesHandComputedReference() {
        QualityFogNode node = new QualityFogNode();
        // turbidity=40 -> score = 100 - 40/8 = 95
        // dissolvedOxygen=8 -> score = min(100, 80) = 80
        // ph=7.2 -> score = 100 - 0*40 = 100
        // conductivity/temperature unknown -> midpoint 50 each
        // cwqi = 95*0.30 + 80*0.25 + 100*0.20 + 50*0.15 + 50*0.10
        //      = 28.5 + 20 + 20 + 7.5 + 5 = 81.0
        node.onReading(reading("reach-mid", "turbidity", 40.0, "NTU"));
        node.onReading(reading("reach-mid", "dissolved-oxygen", 8.0, "mg/L"));
        List<Map<String, Object>> events = node.onReading(reading("reach-mid", "ph", 7.2, "pH"));

        double cwqi = (double) events.get(0).get("cwqi");
        assertEquals(81.0, cwqi, 0.001);
        assertEquals("GOOD", events.get(0).get("band"));
    }

    @Test
    void cwqiFormulaIncludesConductivityAndTemperatureWhenKnown() {
        QualityFogNode node = new QualityFogNode();
        node.onReading(reading("reach-mid", "turbidity", 40.0, "NTU")); // score 95
        node.onReading(reading("reach-mid", "dissolved-oxygen", 8.0, "mg/L")); // score 80
        node.onReading(reading("reach-mid", "conductivity", 90.0, "uS/cm")); // score 100 - 90/9 = 90
        node.onReading(reading("reach-mid", "water-temperature", 15.0, "degC")); // score 100
        List<Map<String, Object>> events = node.onReading(reading("reach-mid", "ph", 7.2, "pH")); // score 100

        // cwqi = 95*0.30 + 80*0.25 + 100*0.20 + 90*0.15 + 100*0.10
        //      = 28.5 + 20 + 20 + 13.5 + 10 = 92.0
        double cwqi = (double) events.get(0).get("cwqi");
        assertEquals(92.0, cwqi, 0.001);
    }

    @Test
    void regularDispatchOnlyOnBandTransition() {
        QualityFogNode node = new QualityFogNode();
        node.onReading(reading("reach-mid", "turbidity", 40.0, "NTU"));
        node.onReading(reading("reach-mid", "dissolved-oxygen", 8.0, "mg/L"));
        List<Map<String, Object>> first = node.onReading(reading("reach-mid", "ph", 7.2, "pH"));
        assertEquals(1, first.size());
        assertEquals("GOOD", first.get(0).get("band"));

        // small ph wobble that keeps cwqi within GOOD band -> no dispatch
        List<Map<String, Object>> second = node.onReading(reading("reach-mid", "ph", 7.25, "pH"));
        assertTrue(second.isEmpty());
    }

    @Test
    void dispatchesAgainWhenBandActuallyChanges() {
        QualityFogNode node = new QualityFogNode();
        node.onReading(reading("reach-mid", "turbidity", 40.0, "NTU"));
        node.onReading(reading("reach-mid", "dissolved-oxygen", 8.0, "mg/L"));
        node.onReading(reading("reach-mid", "ph", 7.2, "pH")); // GOOD (cwqi 81)

        // crank turbidity way up to push cwqi below 70 into FAIR
        List<Map<String, Object>> events = node.onReading(reading("reach-mid", "turbidity", 500.0, "NTU"));
        assertEquals(1, events.size());
        assertEquals("FAIR", events.get(0).get("band"));
    }

    @Test
    void bandBoundariesGoodFairPoor() {
        QualityFogNode node = new QualityFogNode();
        node.onReading(reading("reach-mid", "dissolved-oxygen", 8.0, "mg/L"));
        node.onReading(reading("reach-mid", "ph", 7.2, "pH"));
        // turbidity=10, do=8, ph=7.2 -> cwqi ~82.1 GOOD
        List<Map<String, Object>> goodEvents = node.onReading(reading("reach-mid", "turbidity", 10.0, "NTU"));
        assertEquals("GOOD", goodEvents.get(0).get("band"));

        // ph=7.0 keeps it GOOD (~80.5); do=3.0 (its valid minimum) then crosses into FAIR (~68.0)
        node.onReading(reading("reach-mid", "ph", 7.0, "pH"));
        List<Map<String, Object>> fairEvents = node.onReading(reading("reach-mid", "dissolved-oxygen", 3.0, "mg/L"));
        assertEquals("FAIR", fairEvents.get(0).get("band"));

        // ph=6.0 keeps it FAIR (~60.0); turbidity=800 (its valid maximum) then crosses into POOR (~30.4)
        node.onReading(reading("reach-mid", "ph", 6.0, "pH"));
        List<Map<String, Object>> poorEvents = node.onReading(reading("reach-mid", "turbidity", 800.0, "NTU"));
        assertEquals("POOR", poorEvents.get(0).get("band"));
    }

    @Test
    void contaminationRequiresBothTurbiditySpikeAndLowDissolvedOxygen() {
        QualityFogNode node = new QualityFogNode();
        // build a 6-sample turbidity window with a stable baseline around 10 NTU
        for (int i = 0; i < 6; i++) {
            node.onReading(reading("reach-mid", "turbidity", 10.0, "NTU"));
        }
        node.onReading(reading("reach-mid", "dissolved-oxygen", 8.0, "mg/L")); // healthy DO

        // turbidity spike alone (median ~10, 3x = 30; 50 > 30) but DO is healthy -> no contamination event
        List<Map<String, Object>> spikeOnly = node.onReading(reading("reach-mid", "turbidity", 50.0, "NTU"));
        assertFalse(hasContaminationEvent(spikeOnly));
    }

    @Test
    void lowDissolvedOxygenAloneDoesNotTriggerContamination() {
        QualityFogNode node = new QualityFogNode();
        for (int i = 0; i < 6; i++) {
            node.onReading(reading("reach-mid", "turbidity", 10.0, "NTU"));
        }
        // DO drops low but turbidity stays at baseline, no spike -> no contamination event
        List<Map<String, Object>> lowDoOnly = node.onReading(reading("reach-mid", "dissolved-oxygen", 3.0, "mg/L"));
        assertFalse(hasContaminationEvent(lowDoOnly));
    }

    @Test
    void turbiditySpikeAndLowDissolvedOxygenTogetherTriggersContaminationImmediately() {
        QualityFogNode node = new QualityFogNode();
        for (int i = 0; i < 6; i++) {
            node.onReading(reading("reach-mid", "turbidity", 10.0, "NTU"));
        }
        node.onReading(reading("reach-mid", "dissolved-oxygen", 3.0, "mg/L")); // low DO, latched

        // now the turbidity spike arrives with low DO already latched -> both conditions true
        List<Map<String, Object>> events = node.onReading(reading("reach-mid", "turbidity", 50.0, "NTU"));
        assertTrue(hasContaminationEvent(events));

        Map<String, Object> contamination = events.stream()
                .filter(e -> Boolean.TRUE.equals(e.get("contaminationSuspected")))
                .findFirst().orElseThrow();
        assertEquals(50.0, contamination.get("turbidity"));
        assertEquals(3.0, contamination.get("dissolvedOxygen"));
        assertFalse(contamination.containsKey("cwqi"));
        assertFalse(contamination.containsKey("band"));
    }

    @Test
    void contaminationNeedsAtLeast6Samples() {
        QualityFogNode node = new QualityFogNode();
        for (int i = 0; i < 4; i++) {
            node.onReading(reading("reach-mid", "turbidity", 10.0, "NTU"));
        }
        node.onReading(reading("reach-mid", "dissolved-oxygen", 3.0, "mg/L"));

        // the spike reading itself joins the window, making it only 5 samples total -> below the
        // 6-sample minimum, so the contamination check should not fire even with both conditions true
        List<Map<String, Object>> events = node.onReading(reading("reach-mid", "turbidity", 500.0, "NTU"));
        assertFalse(hasContaminationEvent(events));
    }

    private static boolean hasContaminationEvent(List<Map<String, Object>> events) {
        return events.stream().anyMatch(e -> Boolean.TRUE.equals(e.get("contaminationSuspected")));
    }
}
