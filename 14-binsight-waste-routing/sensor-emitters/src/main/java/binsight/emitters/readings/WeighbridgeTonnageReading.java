package binsight.emitters.readings;

import java.util.concurrent.ThreadLocalRandom;

/** Depot weighbridge reading in tonnes, 0-12; near-zero between truck weigh-ins, spikes when a truck crosses. */
public class WeighbridgeTonnageReading implements ReadingGenerator {

    private double value;

    public WeighbridgeTonnageReading() {
        this.value = 0;
    }

    @Override
    public String metricName() {
        return "weighbridge-tonnage";
    }

    @Override
    public String unit() {
        return "tonnes";
    }

    @Override
    public Object nextValue() {
        if (ThreadLocalRandom.current().nextDouble() < 0.2) {
            // a truck is on the weighbridge
            value = ThreadLocalRandom.current().nextDouble(2, 12);
        } else {
            value = Math.max(0, value - ThreadLocalRandom.current().nextDouble(1, 3));
        }
        return value;
    }
}
