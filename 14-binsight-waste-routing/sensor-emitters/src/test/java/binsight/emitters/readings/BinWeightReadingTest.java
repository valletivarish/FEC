package binsight.emitters.readings;

import org.junit.jupiter.api.Test;

import static org.junit.jupiter.api.Assertions.assertTrue;

class BinWeightReadingTest {

    @Test
    void staysWithinZeroToTwoFortyAcrossManyIterations() {
        BinWeightReading reading = new BinWeightReading();
        for (int i = 0; i < 5000; i++) {
            double value = (double) reading.nextValue();
            assertTrue(value >= 0 && value <= 240, "bin-weight out of bounds: " + value);
        }
    }
}
