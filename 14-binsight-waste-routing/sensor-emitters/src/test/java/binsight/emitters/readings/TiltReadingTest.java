package binsight.emitters.readings;

import org.junit.jupiter.api.Test;

import static org.junit.jupiter.api.Assertions.assertTrue;

class TiltReadingTest {

    @Test
    void staysWithinZeroToNinetyAcrossManyIterations() {
        TiltReading reading = new TiltReading();
        for (int i = 0; i < 5000; i++) {
            double value = (double) reading.nextValue();
            assertTrue(value >= 0 && value <= 90, "tilt out of bounds: " + value);
        }
    }
}
