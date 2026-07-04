package binsight.emitters.readings;

import org.junit.jupiter.api.Test;

import static org.junit.jupiter.api.Assertions.assertTrue;

class MethanePpmReadingTest {

    @Test
    void staysWithinZeroToTenThousandAcrossManyIterations() {
        MethanePpmReading reading = new MethanePpmReading();
        for (int i = 0; i < 5000; i++) {
            double value = (double) reading.nextValue();
            assertTrue(value >= 0 && value <= 10000, "methane-ppm out of bounds: " + value);
        }
    }
}
