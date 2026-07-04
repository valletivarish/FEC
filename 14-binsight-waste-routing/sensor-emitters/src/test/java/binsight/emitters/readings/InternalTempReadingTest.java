package binsight.emitters.readings;

import org.junit.jupiter.api.Test;

import static org.junit.jupiter.api.Assertions.assertTrue;

class InternalTempReadingTest {

    @Test
    void staysWithinMinusFiveTo85AcrossManyIterations() {
        InternalTempReading reading = new InternalTempReading();
        for (int i = 0; i < 5000; i++) {
            double value = (double) reading.nextValue();
            assertTrue(value >= -5 && value <= 85, "internal-temp out of bounds: " + value);
        }
    }
}
