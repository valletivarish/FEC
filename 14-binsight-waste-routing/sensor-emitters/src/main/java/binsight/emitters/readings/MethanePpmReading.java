package binsight.emitters.readings;

import java.util.concurrent.ThreadLocalRandom;

/** Methane concentration in ppm, 0-10000; normally low with occasional spikes to exercise fire-risk logic. */
public class MethanePpmReading implements ReadingGenerator {

    private double value;

    public MethanePpmReading() {
        this.value = ThreadLocalRandom.current().nextDouble(0, 200);
    }

    @Override
    public String metricName() {
        return "methane-ppm";
    }

    @Override
    public String unit() {
        return "ppm";
    }

    @Override
    public Object nextValue() {
        // rare larger jump so downstream fire-risk scoring sees WATCH/CRITICAL occasionally
        double maxStep = ThreadLocalRandom.current().nextDouble() < 0.05 ? 2500 : 150;
        value = BoundedRandomWalk.step(value, maxStep, 0, 10000);
        return value;
    }
}
