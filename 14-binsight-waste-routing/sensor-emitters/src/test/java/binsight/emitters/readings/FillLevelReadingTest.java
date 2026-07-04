package binsight.emitters.readings;

import org.junit.jupiter.api.Test;

import static org.junit.jupiter.api.Assertions.assertTrue;

class FillLevelReadingTest {

    @Test
    void staysWithinZeroToHundredAcrossManyIterations() {
        FillLevelReading reading = new FillLevelReading();
        for (int i = 0; i < 5000; i++) {
            double value = (double) reading.nextValue();
            assertTrue(value >= 0 && value <= 100, "fill-level out of bounds: " + value);
        }
    }

    @Test
    void reportsCorrectMetricNameAndUnit() {
        FillLevelReading reading = new FillLevelReading();
        assertTrue(reading.metricName().equals("fill-level"));
        assertTrue(reading.unit().equals("%"));
    }
}
