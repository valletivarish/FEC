package edu.msc.chainfrost.fog.telematicsfog;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertTrue;

import java.time.Duration;
import java.time.Instant;

import org.junit.jupiter.api.Test;

class GpsThinnerTest {

    private static final String TRUCK_ID = "truck-1";
    private final Instant t0 = Instant.parse("2026-07-02T10:00:00Z");

    @Test
    void firstPointIsAlwaysDispatched() {
        GpsThinner thinner = new GpsThinner();
        var result = thinner.offer(TRUCK_ID, new GpsPoint(40.0, -74.0, 60.0, t0));
        assertTrue(result.isPresent());
    }

    @Test
    void tinyMovementUnder25MetersIsDropped() {
        GpsThinner thinner = new GpsThinner();
        thinner.offer(TRUCK_ID, new GpsPoint(40.0000, -74.0000, 60.0, t0));
        // ~1 meter of latitude drift, well under threshold
        var result = thinner.offer(TRUCK_ID, new GpsPoint(40.000009, -74.0000, 60.0, t0.plusSeconds(10)));
        assertFalse(result.isPresent());
    }

    @Test
    void movementOver25MetersIsDispatched() {
        GpsThinner thinner = new GpsThinner();
        thinner.offer(TRUCK_ID, new GpsPoint(40.0000, -74.0000, 60.0, t0));
        // ~55 meters of latitude drift
        var result = thinner.offer(TRUCK_ID, new GpsPoint(40.0005, -74.0000, 60.0, t0.plusSeconds(10)));
        assertTrue(result.isPresent());
    }

    @Test
    void elapsedOver5MinutesForcesDispatchEvenWithNoMovement() {
        GpsThinner thinner = new GpsThinner();
        thinner.offer(TRUCK_ID, new GpsPoint(40.0000, -74.0000, 60.0, t0));
        var result = thinner.offer(TRUCK_ID, new GpsPoint(40.0000, -74.0000, 60.0, t0.plus(Duration.ofMinutes(6))));
        assertTrue(result.isPresent());
    }

    @Test
    void elapsedUnder5MinutesWithNoMovementOrSpeedChangeIsDropped() {
        GpsThinner thinner = new GpsThinner();
        thinner.offer(TRUCK_ID, new GpsPoint(40.0000, -74.0000, 60.0, t0));
        var result = thinner.offer(TRUCK_ID, new GpsPoint(40.0000, -74.0000, 60.0, t0.plus(Duration.ofMinutes(2))));
        assertFalse(result.isPresent());
    }

    @Test
    void speedChangeOver20KmhForcesDispatch() {
        GpsThinner thinner = new GpsThinner();
        thinner.offer(TRUCK_ID, new GpsPoint(40.0000, -74.0000, 60.0, t0));
        var result = thinner.offer(TRUCK_ID, new GpsPoint(40.0000, -74.0000, 85.0, t0.plusSeconds(10)));
        assertTrue(result.isPresent());
    }

    @Test
    void speedChangeUnder20KmhIsDropped() {
        GpsThinner thinner = new GpsThinner();
        thinner.offer(TRUCK_ID, new GpsPoint(40.0000, -74.0000, 60.0, t0));
        var result = thinner.offer(TRUCK_ID, new GpsPoint(40.0000, -74.0000, 72.0, t0.plusSeconds(10)));
        assertFalse(result.isPresent());
    }

    @Test
    void haversineKnownDistanceIsApproximatelyCorrect() {
        // roughly 1 degree of latitude at the equator is ~111.32km
        double meters = GpsThinner.haversineMeters(0.0, 0.0, 1.0, 0.0);
        assertEquals(111195.0, meters, 50.0);
    }
}
