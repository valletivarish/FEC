package edu.msc.chainfrost.fog.telematicsfog;

import java.time.Instant;

/** A single GPS fix with the speed reported around the same time. */
public record GpsPoint(double lat, double lon, double speedKmh, Instant timestamp) {
}
