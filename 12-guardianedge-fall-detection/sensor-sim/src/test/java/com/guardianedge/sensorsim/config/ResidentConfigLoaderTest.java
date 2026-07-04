package com.guardianedge.sensorsim.config;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;

import java.util.Set;
import org.junit.jupiter.api.Test;

class ResidentConfigLoaderTest {

    private final ResidentConfigLoader loader = new ResidentConfigLoader();

    @Test
    void loadsAllTenMetricsForResidentOne() {
        ResidentSensorConfig config = loader.loadFromClasspath("resident-01.yaml");

        assertEquals("resident-01", config.getResidentId());
        Set<String> expectedMetrics = Set.of("heartrate", "spo2", "resprate", "skintemp", "ecgrr",
                "accelerometer", "gyroscope", "room-pir", "room-ambienttemp", "room-airquality");
        assertEquals(expectedMetrics, config.getMetrics().keySet());
    }

    @Test
    void appliesIndependentSampleAndDispatchIntervalsPerMetric() {
        ResidentSensorConfig config = loader.loadFromClasspath("resident-01.yaml");

        MetricSchedule heartrate = config.scheduleFor("heartrate");
        MetricSchedule skintemp = config.scheduleFor("skintemp");
        MetricSchedule gyroscope = config.scheduleFor("gyroscope");

        assertEquals(1, heartrate.getSampleIntervalSeconds());
        assertEquals(1, heartrate.getDispatchIntervalSeconds());

        assertEquals(6, skintemp.getSampleIntervalSeconds());
        assertEquals(6, skintemp.getDispatchIntervalSeconds());

        // gyroscope samples faster than it dispatches — this is exactly the independence the loader must preserve.
        assertEquals(1, gyroscope.getSampleIntervalSeconds());
        assertEquals(2, gyroscope.getDispatchIntervalSeconds());
        assertTrue(gyroscope.getSampleIntervalSeconds() != gyroscope.getDispatchIntervalSeconds());
    }

    @Test
    void differentResidentsCanHaveDifferentSchedulesForTheSameMetric() {
        ResidentSensorConfig resident01 = loader.loadFromClasspath("resident-01.yaml");
        ResidentSensorConfig resident02 = loader.loadFromClasspath("resident-02.yaml");

        MetricSchedule r1Heartrate = resident01.scheduleFor("heartrate");
        MetricSchedule r2Heartrate = resident02.scheduleFor("heartrate");

        assertEquals(1, r1Heartrate.getDispatchIntervalSeconds());
        assertEquals(2, r2Heartrate.getDispatchIntervalSeconds());
    }

    @Test
    void loadsResidentTwoAndThreeWithDistinctResidentIds() {
        assertEquals("resident-02", loader.loadFromClasspath("resident-02.yaml").getResidentId());
        assertEquals("resident-03", loader.loadFromClasspath("resident-03.yaml").getResidentId());
    }

    @Test
    void missingMetricLookupThrows() {
        ResidentSensorConfig config = loader.loadFromClasspath("resident-01.yaml");
        assertThrows(IllegalArgumentException.class, () -> config.scheduleFor("does-not-exist"));
    }

    @Test
    void missingClasspathResourceThrows() {
        assertThrows(IllegalArgumentException.class, () -> loader.loadFromClasspath("resident-99.yaml"));
    }
}
