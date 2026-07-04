package binsight.emitters.readings;

import java.util.concurrent.ThreadLocalRandom;

/** Truck fuel level percentage, 0-100; steadily depletes with occasional refuel jumps back up. */
public class FuelLevelReading implements ReadingGenerator {

    private double value;

    public FuelLevelReading() {
        this.value = ThreadLocalRandom.current().nextDouble(50, 100);
    }

    @Override
    public String metricName() {
        return "fuel-level";
    }

    @Override
    public String unit() {
        return "%";
    }

    @Override
    public Object nextValue() {
        if (value < 15 && ThreadLocalRandom.current().nextDouble() < 0.15) {
            // refuel stop
            value = ThreadLocalRandom.current().nextDouble(85, 100);
            return value;
        }
        double delta = ThreadLocalRandom.current().nextDouble(-1.5, 0.1);
        value = Math.max(0, Math.min(100, value + delta));
        return value;
    }
}
