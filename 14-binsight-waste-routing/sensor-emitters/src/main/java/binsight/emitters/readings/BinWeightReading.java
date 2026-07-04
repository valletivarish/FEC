package binsight.emitters.readings;

import java.util.concurrent.ThreadLocalRandom;

/** Bin weight in kg, 0-240, mirrors fill-level's gradual-increase pattern. */
public class BinWeightReading implements ReadingGenerator {

    private double value;

    public BinWeightReading() {
        this.value = ThreadLocalRandom.current().nextDouble(5, 60);
    }

    @Override
    public String metricName() {
        return "bin-weight";
    }

    @Override
    public String unit() {
        return "kg";
    }

    @Override
    public Object nextValue() {
        value = BoundedRandomWalk.step(value, 4.0, 0, 240);
        return value;
    }
}
