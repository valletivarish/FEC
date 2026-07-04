package com.guardianedge.sensorsim.emit;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertTrue;

import com.guardianedge.sensorsim.model.SensorReading;
import org.junit.jupiter.api.Test;

class VitalSignEmitterTest {

    private static final int ITERATIONS = 5000;

    @Test
    void heartrateStaysWithinDocumentedBounds() {
        VitalSignEmitter emitter = new VitalSignEmitter("resident-01");
        for (int i = 0; i < ITERATIONS; i++) {
            SensorReading reading = emitter.nextHeartrate();
            assertEquals("heartrate", reading.getMetric());
            assertEquals("bpm", reading.getUnit());
            assertWithinBounds(reading.getValue(), 40.0, 180.0);
        }
    }

    @Test
    void spo2StaysWithinDocumentedBounds() {
        VitalSignEmitter emitter = new VitalSignEmitter("resident-01");
        for (int i = 0; i < ITERATIONS; i++) {
            SensorReading reading = emitter.nextSpo2();
            assertWithinBounds(reading.getValue(), 80.0, 100.0);
        }
    }

    @Test
    void resprateStaysWithinDocumentedBounds() {
        VitalSignEmitter emitter = new VitalSignEmitter("resident-01");
        for (int i = 0; i < ITERATIONS; i++) {
            SensorReading reading = emitter.nextResprate();
            assertWithinBounds(reading.getValue(), 6.0, 40.0);
        }
    }

    @Test
    void skintempStaysWithinDocumentedBounds() {
        VitalSignEmitter emitter = new VitalSignEmitter("resident-01");
        for (int i = 0; i < ITERATIONS; i++) {
            SensorReading reading = emitter.nextSkintemp();
            assertWithinBounds(reading.getValue(), 33.0, 40.0);
        }
    }

    @Test
    void ecgrrStaysWithinDocumentedBounds() {
        VitalSignEmitter emitter = new VitalSignEmitter("resident-01");
        for (int i = 0; i < ITERATIONS; i++) {
            SensorReading reading = emitter.nextEcgrr();
            assertWithinBounds(reading.getValue(), 400.0, 1600.0);
        }
    }

    @Test
    void readingsCarryTheOwningResidentId() {
        VitalSignEmitter emitter = new VitalSignEmitter("resident-02");
        SensorReading reading = emitter.nextHeartrate();
        assertEquals("resident-02", reading.getResidentId());
        assertFalse(reading.getTimestamp().isBlank());
    }

    private void assertWithinBounds(double value, double min, double max) {
        assertTrue(value >= min && value <= max, () -> "value " + value + " outside [" + min + "," + max + "]");
    }
}
