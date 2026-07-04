package ie.nci.flowforge.rig.channels;

/** One instance per pump per metric; holds no pump identity so it can be reused across pumps. */
public interface SensorChannel {

    String metricName();

    String unit();

    double initialValue();

    double nextValue(double previousValue);
}
