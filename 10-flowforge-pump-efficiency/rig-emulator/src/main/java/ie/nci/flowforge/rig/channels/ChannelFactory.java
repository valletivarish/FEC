package ie.nci.flowforge.rig.channels;

import java.util.Map;
import java.util.function.Supplier;

/** Central registry so the launcher and config loader don't each hardcode the 10 metric names. */
public final class ChannelFactory {

    private static final Map<String, Supplier<SensorChannel>> SUPPLIERS = Map.ofEntries(
            Map.entry("vibration", VibrationChannel::new),
            Map.entry("bearing-temp", BearingTempChannel::new),
            Map.entry("motor-current", MotorCurrentChannel::new),
            Map.entry("inlet-pressure", InletPressureChannel::new),
            Map.entry("outlet-pressure", OutletPressureChannel::new),
            Map.entry("flow-rate", FlowRateChannel::new),
            Map.entry("seal-leak", SealLeakChannel::new),
            Map.entry("rpm", RpmChannel::new),
            Map.entry("power-draw", PowerDrawChannel::new),
            Map.entry("turbidity", TurbidityChannel::new));

    private ChannelFactory() {
    }

    public static SensorChannel create(String metricName) {
        Supplier<SensorChannel> supplier = SUPPLIERS.get(metricName);
        if (supplier == null) {
            throw new IllegalArgumentException("Unknown metric: " + metricName);
        }
        return supplier.get();
    }

    public static Iterable<String> metricNames() {
        return SUPPLIERS.keySet();
    }
}
