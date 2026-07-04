package binsight.emitters.readings;

import org.junit.jupiter.api.Test;

import static org.junit.jupiter.api.Assertions.assertTrue;

class HopperFillReadingTest {

    @Test
    void staysWithinZeroToHundredAcrossManyIterations() {
        HopperFillReading reading = new HopperFillReading();
        for (int i = 0; i < 5000; i++) {
            double value = (double) reading.nextValue();
            assertTrue(value >= 0 && value <= 100, "hopper-fill out of bounds: " + value);
        }
    }
}
