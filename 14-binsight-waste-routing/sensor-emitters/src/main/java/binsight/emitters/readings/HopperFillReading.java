package binsight.emitters.readings;

import java.util.concurrent.ThreadLocalRandom;

/** Truck hopper fill percentage, 0-100; rises as bins are emptied into it, occasionally drops on tip-off. */
public class HopperFillReading implements ReadingGenerator {

    private double value;

    public HopperFillReading() {
        this.value = ThreadLocalRandom.current().nextDouble(0, 20);
    }

    @Override
    public String metricName() {
        return "hopper-fill";
    }

    @Override
    public String unit() {
        return "%";
    }

    @Override
    public Object nextValue() {
        if (value > 90 && ThreadLocalRandom.current().nextDouble() < 0.1) {
            // tipped off at the depot's weighbridge
            value = ThreadLocalRandom.current().nextDouble(0, 10);
            return value;
        }
        double delta = ThreadLocalRandom.current().nextDouble(-1, 4);
        value = Math.max(0, Math.min(100, value + delta));
        return value;
    }
}
