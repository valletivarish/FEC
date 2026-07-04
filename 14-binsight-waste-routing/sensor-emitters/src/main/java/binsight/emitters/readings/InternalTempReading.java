package binsight.emitters.readings;

import java.util.concurrent.ThreadLocalRandom;

/** Bin internal temperature in degC, -5 to 85; ambient-driven so steps are small. */
public class InternalTempReading implements ReadingGenerator {

    private double value;

    public InternalTempReading() {
        this.value = ThreadLocalRandom.current().nextDouble(12, 22);
    }

    @Override
    public String metricName() {
        return "internal-temp";
    }

    @Override
    public String unit() {
        return "degC";
    }

    @Override
    public Object nextValue() {
        value = BoundedRandomWalk.step(value, 1.5, -5, 85);
        return value;
    }
}
