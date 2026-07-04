package ie.nci.flowforge.rig.channels;

import org.junit.jupiter.api.Test;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertThrows;

class ChannelFactoryTest {

    @Test
    void createsAChannelMatchingTheRequestedMetric() {
        SensorChannel channel = ChannelFactory.create("vibration");
        assertEquals("vibration", channel.metricName());
    }

    @Test
    void rejectsAnUnknownMetric() {
        assertThrows(IllegalArgumentException.class, () -> ChannelFactory.create("not-a-metric"));
    }
}
