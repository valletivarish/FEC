package binsight.emitters.config;

import org.junit.jupiter.api.Test;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;

class SensorProfileLoaderTest {

    private final SensorProfileLoader loader = new SensorProfileLoader();

    @Test
    void loadsEntityIdAndEntityTypeFromYaml() {
        SensorProfile profile = loader.load("test-bin-99");
        assertEquals("test-bin-99", profile.getEntityId());
        assertEquals("bin", profile.getEntityType());
    }

    @Test
    void appliesIndependentSampleAndDispatchIntervalsPerMetric() {
        SensorProfile profile = loader.load("test-bin-99");

        MetricSchedule fillLevel = profile.getSchedule("fill-level");
        assertEquals(5, fillLevel.getSampleIntervalSeconds());
        assertEquals(6, fillLevel.getDispatchIntervalSeconds());

        MetricSchedule binWeight = profile.getSchedule("bin-weight");
        assertEquals(7, binWeight.getSampleIntervalSeconds());
        assertEquals(9, binWeight.getDispatchIntervalSeconds());

        MetricSchedule lidState = profile.getSchedule("lid-state");
        assertEquals(11, lidState.getSampleIntervalSeconds());
        assertEquals(13, lidState.getDispatchIntervalSeconds());

        // each metric's pair of intervals must be independently distinct, not a single shared cadence
        assertTrue(fillLevel.getSampleIntervalSeconds() != binWeight.getSampleIntervalSeconds());
        assertTrue(fillLevel.getDispatchIntervalSeconds() != lidState.getDispatchIntervalSeconds());
    }

    @Test
    void throwsWhenProfileIsMissingFromClasspath() {
        assertThrows(IllegalArgumentException.class, () -> loader.load("no-such-entity"));
    }
}
