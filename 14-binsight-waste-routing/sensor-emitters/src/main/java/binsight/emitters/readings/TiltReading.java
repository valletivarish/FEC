package binsight.emitters.readings;

import java.util.concurrent.ThreadLocalRandom;

/** Tilt from vertical in degrees, 0-90; usually near-upright with rare knock-over events. */
public class TiltReading implements ReadingGenerator {

    private double value;

    public TiltReading() {
        this.value = ThreadLocalRandom.current().nextDouble(0, 5);
    }

    @Override
    public String metricName() {
        return "tilt";
    }

    @Override
    public String unit() {
        return "degrees";
    }

    @Override
    public Object nextValue() {
        double maxStep = ThreadLocalRandom.current().nextDouble() < 0.03 ? 40 : 3;
        value = BoundedRandomWalk.step(value, maxStep, 0, 90);
        return value;
    }
}
