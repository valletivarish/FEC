package binsight.emitters.readings;

import java.util.concurrent.ThreadLocalRandom;

/** Lid state enum; mostly CLOSED since a bin sits shut between deposits. */
public class LidStateReading implements ReadingGenerator {

    private static final String[] STATES = {"CLOSED", "OPEN", "AJAR"};

    @Override
    public String metricName() {
        return "lid-state";
    }

    @Override
    public String unit() {
        return "enum";
    }

    @Override
    public Object nextValue() {
        double roll = ThreadLocalRandom.current().nextDouble();
        if (roll < 0.85) {
            return STATES[0];
        } else if (roll < 0.95) {
            return STATES[1];
        }
        return STATES[2];
    }
}
