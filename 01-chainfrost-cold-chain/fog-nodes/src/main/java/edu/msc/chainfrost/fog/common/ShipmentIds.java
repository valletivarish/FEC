package edu.msc.chainfrost.fog.common;

import java.time.Instant;
import java.time.ZoneOffset;
import java.time.format.DateTimeFormatter;

/**
 * shipmentId is derived, not stored, so every producer (fog nodes, backend) must
 * compute it identically from truckId and the current UTC date.
 */
public final class ShipmentIds {

    private static final DateTimeFormatter DATE_FORMAT = DateTimeFormatter.ofPattern("yyyy-MM-dd")
            .withZone(ZoneOffset.UTC);

    private ShipmentIds() {
    }

    public static String forTruckNow(String truckId) {
        return forTruck(truckId, Instant.now());
    }

    public static String forTruck(String truckId, Instant at) {
        return truckId + "-" + DATE_FORMAT.format(at);
    }
}
