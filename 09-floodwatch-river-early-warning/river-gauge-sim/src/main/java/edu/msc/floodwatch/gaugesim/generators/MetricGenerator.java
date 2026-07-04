package edu.msc.floodwatch.gaugesim.generators;

/** Common shape for a metric's bounded random-walk generator, so the app can drive any of them uniformly. */
public interface MetricGenerator {

    String metricName();

    String unit();

    /** Seed value for the first sample, roughly mid-range so a reach doesn't start at an extreme. */
    double initialValue();

    double nextValue(double previousValue);
}
