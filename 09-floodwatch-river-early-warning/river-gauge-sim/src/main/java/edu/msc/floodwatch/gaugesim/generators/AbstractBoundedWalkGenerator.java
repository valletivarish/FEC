package edu.msc.floodwatch.gaugesim.generators;

import java.util.concurrent.ThreadLocalRandom;

/** Bounded random walk: each step nudges the previous value by up to +/-maxStep, clamped to [min, max]. */
abstract class AbstractBoundedWalkGenerator implements MetricGenerator {

    private final double min;
    private final double max;
    private final double maxStep;

    protected AbstractBoundedWalkGenerator(double min, double max, double maxStep) {
        this.min = min;
        this.max = max;
        this.maxStep = maxStep;
    }

    @Override
    public double initialValue() {
        return min + (max - min) * 0.5;
    }

    @Override
    public double nextValue(double previousValue) {
        double step = ThreadLocalRandom.current().nextDouble(-maxStep, maxStep);
        double candidate = previousValue + step;
        return Math.max(min, Math.min(max, candidate));
    }
}
