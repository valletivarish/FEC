package edu.msc.chainfrost.backend.model;

import java.time.Instant;

/**
 * Mirrors the item shape stored in ChainFrostShipments - one row per
 * shipmentId tracking the latest known reefer and compliance state.
 */
public record ShipmentRecord(
        String shipmentId,
        String truckId,
        Double latestZone1Temp,
        Double latestZone2Temp,
        Double latestMkt,
        Double humidityPct,
        String complianceStatus,
        Instant lastUpdated
) {
}
