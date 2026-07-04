package binsight.emitters.readings;

import java.util.concurrent.ThreadLocalRandom;

/**
 * Shared step-and-clamp logic so every numeric metric wanders plausibly instead
 * of jumping to a fresh independent value each tick.
 */
final class BoundedRandomWalk {

    private BoundedRandomWalk() {
    }

    static double step(double current, double maxStep, double min, double max) {
        double delta = ThreadLocalRandom.current().nextDouble(-maxStep, maxStep);
        double next = current + delta;
        return Math.max(min, Math.min(max, next));
    }
}
