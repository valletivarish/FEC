package binsight.emitters.readings;

/**
 * One instance tracks a single metric's evolving state for one entity, so
 * successive calls produce a bounded random walk rather than independent noise.
 */
public interface ReadingGenerator {

    /** Metric name as it appears in the MQTT payload and topic, e.g. "fill-level". */
    String metricName();

    /** Unit string for the payload, e.g. "%", "kg", "degC". */
    String unit();

    /** Next value in the walk: Double, String (lid-state) or a Map (truck-gps). */
    Object nextValue();
}
