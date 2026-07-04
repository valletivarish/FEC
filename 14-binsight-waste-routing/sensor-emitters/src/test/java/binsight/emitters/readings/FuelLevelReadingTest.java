package binsight.emitters.readings;

import org.junit.jupiter.api.Test;

import static org.junit.jupiter.api.Assertions.assertTrue;

class FuelLevelReadingTest {

    @Test
    void staysWithinZeroToHundredAcrossManyIterations() {
        FuelLevelReading reading = new FuelLevelReading();
        for (int i = 0; i < 5000; i++) {
            double value = (double) reading.nextValue();
            assertTrue(value >= 0 && value <= 100, "fuel-level out of bounds: " + value);
        }
    }
}
