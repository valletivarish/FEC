package binsight.emitters.readings;

import java.util.concurrent.ThreadLocalRandom;

/** Bin fill percentage, 0-100, drifts upward on average (bins fill, they don't self-empty). */
public class FillLevelReading implements ReadingGenerator {

    private double value;

    public FillLevelReading() {
        this.value = ThreadLocalRandom.current().nextDouble(5, 30);
    }

    @Override
    public String metricName() {
        return "fill-level";
    }

    @Override
    public String unit() {
        return "%";
    }

    @Override
    public Object nextValue() {
        // slight upward bias models gradual filling between collections
        double delta = ThreadLocalRandom.current().nextDouble(-0.5, 2.5);
        value = Math.max(0, Math.min(100, value + delta));
        return value;
    }
}
