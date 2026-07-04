package edu.msc.chainfrost.fog.common;

import java.time.Instant;
import java.util.Map;

/**
 * Normalized event emitted by every fog node onto the Kinesis telemetry stream.
 * The backend ingest Lambda fans this out to DynamoDB by eventType.
 */
public record FogEvent(
        String truckId,
        String shipmentId,
        String eventType,
        String severity,
        Map<String, Object> payload,
        Instant timestamp) {
}
