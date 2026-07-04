package edu.msc.chainfrost.reefersim.config;

/**
 * Describes how one sensor topic should be simulated: its value bounds,
 * how often to sample, and how often to batch-dispatch to the publisher.
 */
public record SensorProfile(
        String topic,
        String unit,
        double min,
        double max,
        long sampleFrequencyMs,
        long dispatchRateMs,
        String valueModel) {

    public SensorProfile {
        if (dispatchRateMs < sampleFrequencyMs) {
            throw new IllegalArgumentException(
                    "dispatchRateMs (" + dispatchRateMs + ") must be >= sampleFrequencyMs ("
                            + sampleFrequencyMs + ") for topic " + topic);
        }
    }
}
