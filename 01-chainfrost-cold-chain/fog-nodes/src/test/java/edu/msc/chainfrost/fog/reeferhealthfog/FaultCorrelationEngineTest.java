package edu.msc.chainfrost.fog.reeferhealthfog;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertTrue;

import java.time.Duration;
import java.time.Instant;
import java.util.Optional;

import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;

class FaultCorrelationEngineTest {

    private static final String TRUCK_ID = "truck-1";
    private Instant t0;
    private FaultCorrelationEngine engine;

    @BeforeEach
    void setUp() {
        t0 = Instant.parse("2026-07-02T10:00:00Z");
        engine = new FaultCorrelationEngine(new TruckStateCache());
    }

    @Test
    void doorOpenUnder90SecondsIsNoFault() {
        engine.evaluateDoorState(TRUCK_ID, true, t0);
        Optional<FaultFinding> finding = engine.evaluateDoorState(TRUCK_ID, true, t0.plusSeconds(60));
        assertFalse(finding.isPresent());
    }

    @Test
    void doorOpenOver90SecondsAtZeroSpeedIsLoadingDoorOpen() {
        engine.recordSpeed(TRUCK_ID, 0.0);
        engine.evaluateDoorState(TRUCK_ID, true, t0);
        Optional<FaultFinding> finding = engine.evaluateDoorState(TRUCK_ID, true, t0.plusSeconds(91));
        assertTrue(finding.isPresent());
        assertEquals(FaultType.LOADING_DOOR_OPEN, finding.get().faultType());
    }

    @Test
    void doorOpenOver90SecondsWhileMovingIsDoorAjarInTransit() {
        engine.recordSpeed(TRUCK_ID, 55.0);
        engine.evaluateDoorState(TRUCK_ID, true, t0);
        Optional<FaultFinding> finding = engine.evaluateDoorState(TRUCK_ID, true, t0.plusSeconds(91));
        assertTrue(finding.isPresent());
        assertEquals(FaultType.DOOR_AJAR_IN_TRANSIT, finding.get().faultType());
    }

    @Test
    void doorClosingResetsTheOpenTimer() {
        engine.recordSpeed(TRUCK_ID, 0.0);
        engine.evaluateDoorState(TRUCK_ID, true, t0);
        engine.evaluateDoorState(TRUCK_ID, false, t0.plusSeconds(30));
        Optional<FaultFinding> finding = engine.evaluateDoorState(TRUCK_ID, true, t0.plusSeconds(100));
        assertFalse(finding.isPresent());
    }

    @Test
    void doorAjarInTransitWithHighHumidityEscalatesToSealBreachSuspected() {
        engine.recordSpeed(TRUCK_ID, 55.0);
        engine.recordHumidity(TRUCK_ID, 91.0);
        engine.evaluateDoorState(TRUCK_ID, true, t0);
        Optional<FaultFinding> finding = engine.evaluateDoorState(TRUCK_ID, true, t0.plusSeconds(91));
        assertTrue(finding.isPresent());
        assertEquals(FaultType.SEAL_BREACH_SUSPECTED, finding.get().faultType());
        assertEquals(91.0, finding.get().details().get("humidityPercent"));
    }

    @Test
    void doorAjarInTransitWithNormalHumidityStaysDoorAjar() {
        engine.recordSpeed(TRUCK_ID, 55.0);
        engine.recordHumidity(TRUCK_ID, 60.0);
        engine.evaluateDoorState(TRUCK_ID, true, t0);
        Optional<FaultFinding> finding = engine.evaluateDoorState(TRUCK_ID, true, t0.plusSeconds(91));
        assertTrue(finding.isPresent());
        assertEquals(FaultType.DOOR_AJAR_IN_TRANSIT, finding.get().faultType());
    }

    @Test
    void doorAjarInTransitWithNoHumidityReadingYetStaysDoorAjar() {
        engine.recordSpeed(TRUCK_ID, 55.0);
        engine.evaluateDoorState(TRUCK_ID, true, t0);
        Optional<FaultFinding> finding = engine.evaluateDoorState(TRUCK_ID, true, t0.plusSeconds(91));
        assertTrue(finding.isPresent());
        assertEquals(FaultType.DOOR_AJAR_IN_TRANSIT, finding.get().faultType());
    }

    @Test
    void highHumidityAtLoadingDockDoesNotEscalateSinceTruckIsStationary() {
        engine.recordSpeed(TRUCK_ID, 0.0);
        engine.recordHumidity(TRUCK_ID, 91.0);
        engine.evaluateDoorState(TRUCK_ID, true, t0);
        Optional<FaultFinding> finding = engine.evaluateDoorState(TRUCK_ID, true, t0.plusSeconds(91));
        assertTrue(finding.isPresent());
        assertEquals(FaultType.LOADING_DOOR_OPEN, finding.get().faultType());
    }

    @Test
    void compressorUnderperformingRequiresFiveContinuousMinutesOfTempDeviation() {
        engine.recordZoneTemp(TRUCK_ID, -14.0);
        engine.recordSetpoint(TRUCK_ID, -20.0);
        engine.evaluateCompressorCurrent(TRUCK_ID, 1.0, t0);
        Optional<FaultFinding> tooEarly = engine.evaluateCompressorCurrent(TRUCK_ID, 1.0, t0.plusSeconds(240));
        assertFalse(tooEarly.isPresent());

        Optional<FaultFinding> finding = engine.evaluateCompressorCurrent(TRUCK_ID, 1.0, t0.plusSeconds(301));
        assertTrue(finding.isPresent());
        assertEquals(FaultType.COMPRESSOR_UNDERPERFORMING, finding.get().faultType());
    }

    @Test
    void compressorUnderperformingDoesNotFireWithoutTempDeviation() {
        engine.recordZoneTemp(TRUCK_ID, -20.5);
        engine.recordSetpoint(TRUCK_ID, -20.0);
        engine.evaluateCompressorCurrent(TRUCK_ID, 1.0, t0);
        Optional<FaultFinding> finding = engine.evaluateCompressorCurrent(TRUCK_ID, 1.0, t0.plusSeconds(400));
        assertFalse(finding.isPresent());
    }

    @Test
    void compressorOverloadRequiresThreeContinuousMinutesAbove15Amps() {
        engine.evaluateCompressorCurrent(TRUCK_ID, 16.0, t0);
        Optional<FaultFinding> tooEarly = engine.evaluateCompressorCurrent(TRUCK_ID, 16.0, t0.plusSeconds(120));
        assertFalse(tooEarly.isPresent());

        Optional<FaultFinding> finding = engine.evaluateCompressorCurrent(TRUCK_ID, 16.0, t0.plusSeconds(181));
        assertTrue(finding.isPresent());
        assertEquals(FaultType.COMPRESSOR_OVERLOAD, finding.get().faultType());
    }

    @Test
    void compressorDroppingBelowOverloadThresholdResetsTheTimer() {
        engine.evaluateCompressorCurrent(TRUCK_ID, 16.0, t0);
        engine.evaluateCompressorCurrent(TRUCK_ID, 10.0, t0.plusSeconds(90));
        Optional<FaultFinding> finding = engine.evaluateCompressorCurrent(TRUCK_ID, 16.0, t0.plusSeconds(300));
        assertFalse(finding.isPresent());
    }

    @Test
    void batteryDroppingFastWhileCompressorActiveIsBatteryDegraded() {
        engine.evaluateCompressorCurrent(TRUCK_ID, 5.0, t0);
        engine.evaluateBatteryLevel(TRUCK_ID, 80.0, t0);
        Optional<FaultFinding> finding = engine.evaluateBatteryLevel(TRUCK_ID, 76.0, t0.plus(Duration.ofMinutes(2)));
        assertTrue(finding.isPresent());
        assertEquals(FaultType.BATTERY_DEGRADED, finding.get().faultType());
    }

    @Test
    void batteryDroppingSlowlyIsNoFault() {
        engine.evaluateCompressorCurrent(TRUCK_ID, 5.0, t0);
        engine.evaluateBatteryLevel(TRUCK_ID, 80.0, t0);
        Optional<FaultFinding> finding = engine.evaluateBatteryLevel(TRUCK_ID, 79.0, t0.plus(Duration.ofMinutes(2)));
        assertFalse(finding.isPresent());
    }

    @Test
    void batteryDroppingFastWithCompressorInactiveIsNoFault() {
        engine.evaluateCompressorCurrent(TRUCK_ID, 0.5, t0);
        engine.evaluateBatteryLevel(TRUCK_ID, 80.0, t0);
        Optional<FaultFinding> finding = engine.evaluateBatteryLevel(TRUCK_ID, 76.0, t0.plus(Duration.ofMinutes(2)));
        assertFalse(finding.isPresent());
    }
}
