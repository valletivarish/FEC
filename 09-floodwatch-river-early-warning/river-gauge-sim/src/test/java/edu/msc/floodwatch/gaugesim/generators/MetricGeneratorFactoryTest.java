package edu.msc.floodwatch.gaugesim.generators;

import org.junit.jupiter.api.Test;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;

class MetricGeneratorFactoryTest {

    @Test
    void createsAGeneratorMatchingTheRequestedMetricName() {
        MetricGenerator generator = MetricGeneratorFactory.create("turbidity");
        assertEquals("turbidity", generator.metricName());
        assertTrue(generator instanceof TurbidityGenerator);
    }

    @Test
    void rejectsAnUnknownMetricName() {
        assertThrows(IllegalArgumentException.class, () -> MetricGeneratorFactory.create("wind-speed"));
    }

    @Test
    void coversAllTenContractMetrics() {
        int count = 0;
        for (String ignored : MetricGeneratorFactory.allMetricNames()) {
            count++;
        }
        assertEquals(10, count);
    }
}
