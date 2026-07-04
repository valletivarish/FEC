package com.guardianedge.sensorsim.emit;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertTrue;

import com.guardianedge.sensorsim.model.SensorReading;
import org.junit.jupiter.api.Test;

class RoomEnvEmitterTest {

    private static final int ITERATIONS = 5000;

    @Test
    void roomPirIsAlwaysZeroOrOne() {
        RoomEnvEmitter emitter = new RoomEnvEmitter("resident-01");
        for (int i = 0; i < ITERATIONS; i++) {
            double value = emitter.nextRoomPir().getValue();
            assertTrue(value == 0.0 || value == 1.0, () -> "room-pir value must be 0 or 1, was " + value);
        }
    }

    @Test
    void roomAmbientTempStaysWithinDocumentedBounds() {
        RoomEnvEmitter emitter = new RoomEnvEmitter("resident-01");
        for (int i = 0; i < ITERATIONS; i++) {
            SensorReading reading = emitter.nextRoomAmbientTemp();
            assertWithinBounds(reading.getValue(), 10.0, 35.0);
        }
    }

    @Test
    void roomAirQualityStaysWithinDocumentedBounds() {
        RoomEnvEmitter emitter = new RoomEnvEmitter("resident-01");
        for (int i = 0; i < ITERATIONS; i++) {
            SensorReading reading = emitter.nextRoomAirQuality();
            assertWithinBounds(reading.getValue(), 400.0, 2000.0);
        }
    }

    @Test
    void metricNamesAndUnitsAreStable() {
        RoomEnvEmitter emitter = new RoomEnvEmitter("resident-03");
        assertEquals("room-pir", emitter.nextRoomPir().getMetric());
        assertEquals("room-ambienttemp", emitter.nextRoomAmbientTemp().getMetric());
        assertEquals("room-airquality", emitter.nextRoomAirQuality().getMetric());
    }

    private void assertWithinBounds(double value, double min, double max) {
        assertTrue(value >= min && value <= max, () -> "value " + value + " outside [" + min + "," + max + "]");
    }
}
