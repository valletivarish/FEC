package edu.msc.chainfrost.reefersim.model;

import java.time.Instant;

/**
 * One sample from a truck sensor, serialized as-is onto its MQTT topic.
 * Shared shape across simulator and fog-layer consumers.
 */
public record SensorReading(String truckId, String topic, double value, Instant timestamp) {
}
