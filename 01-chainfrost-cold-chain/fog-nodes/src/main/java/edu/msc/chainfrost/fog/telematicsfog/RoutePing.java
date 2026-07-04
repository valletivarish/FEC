package edu.msc.chainfrost.fog.telematicsfog;

import java.time.Instant;

/** A thinned GPS point as it appears in a batched TELEMATICS_ROUTE payload. */
public record RoutePing(double lat, double lon, double speedKmh, Instant timestamp) {

    static RoutePing from(GpsPoint point) {
        return new RoutePing(point.lat(), point.lon(), point.speedKmh(), point.timestamp());
    }
}
