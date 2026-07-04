package binsight.emitters.readings;

import org.junit.jupiter.api.Test;

import static org.junit.jupiter.api.Assertions.assertTrue;

class WeighbridgeTonnageReadingTest {

    @Test
    void staysWithinZeroToTwelveAcrossManyIterations() {
        WeighbridgeTonnageReading reading = new WeighbridgeTonnageReading();
        for (int i = 0; i < 5000; i++) {
            double value = (double) reading.nextValue();
            assertTrue(value >= 0 && value <= 12, "weighbridge-tonnage out of bounds: " + value);
        }
    }
}
