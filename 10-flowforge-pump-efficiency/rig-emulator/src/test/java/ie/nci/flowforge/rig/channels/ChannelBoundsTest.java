package ie.nci.flowforge.rig.channels;

import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.MethodSource;

import java.util.List;
import java.util.stream.Stream;

import static org.junit.jupiter.api.Assertions.assertTrue;

class ChannelBoundsTest {

    private static final int ITERATIONS = 5000;

    private static final List<Bounds> CHANNELS = List.of(
            new Bounds(new VibrationChannel(), 0.5, 12.0),
            new Bounds(new BearingTempChannel(), 35.0, 105.0),
            new Bounds(new MotorCurrentChannel(), 8.0, 42.0),
            new Bounds(new InletPressureChannel(), 0.8, 3.5),
            new Bounds(new OutletPressureChannel(), 4.0, 16.0),
            new Bounds(new FlowRateChannel(), 20.0, 450.0),
            new Bounds(new SealLeakChannel(), 0.0, 50.0),
            new Bounds(new RpmChannel(), 800.0, 2950.0),
            new Bounds(new PowerDrawChannel(), 3.0, 75.0),
            new Bounds(new TurbidityChannel(), 0.1, 40.0));

    static Stream<Bounds> channels() {
        return CHANNELS.stream();
    }

    @ParameterizedTest
    @MethodSource("channels")
    void staysWithinBoundsAcrossManyIterations(Bounds bounds) {
        SensorChannel channel = bounds.channel;
        double value = channel.initialValue();
        assertTrue(value >= bounds.min && value <= bounds.max,
                channel.metricName() + " initial value out of range: " + value);

        for (int i = 0; i < ITERATIONS; i++) {
            value = channel.nextValue(value);
            assertTrue(value >= bounds.min && value <= bounds.max,
                    channel.metricName() + " value out of range at iteration " + i + ": " + value);
        }
    }

    @ParameterizedTest
    @MethodSource("channels")
    void reportsAMetricNameAndUnit(Bounds bounds) {
        assertTrue(bounds.channel.metricName() != null && !bounds.channel.metricName().isBlank());
        assertTrue(bounds.channel.unit() != null && !bounds.channel.unit().isBlank());
    }

    private record Bounds(SensorChannel channel, double min, double max) {
    }
}
