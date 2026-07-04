package ie.nci.flowforge.rig.channels;

import java.util.concurrent.ThreadLocalRandom;

/**
 * Random walk clamped to [min, max]; a single reflective clamp (rather than resampling) keeps
 * the walk continuous instead of snapping back to the same boundary value tick after tick.
 */
public abstract class BoundedRandomWalkChannel implements SensorChannel {

    private final double min;
    private final double max;
    private final double maxStep;

    protected BoundedRandomWalkChannel(double min, double max, double maxStep) {
        this.min = min;
        this.max = max;
        this.maxStep = maxStep;
    }

    @Override
    public double initialValue() {
        double mid = (min + max) / 2.0;
        double spread = (max - min) * 0.1;
        return mid + ThreadLocalRandom.current().nextDouble(-spread, spread);
    }

    @Override
    public double nextValue(double previousValue) {
        double step = ThreadLocalRandom.current().nextDouble(-maxStep, maxStep);
        double candidate = previousValue + step;
        if (candidate < min) {
            candidate = min + (min - candidate);
        } else if (candidate > max) {
            candidate = max - (candidate - max);
        }
        return clamp(candidate);
    }

    private double clamp(double value) {
        return Math.max(min, Math.min(max, value));
    }
}
