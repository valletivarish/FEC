package ie.nci.flowforge.rig.channels;

public final class TurbidityChannel extends BoundedRandomWalkChannel {

    public TurbidityChannel() {
        super(0.1, 40.0, 1.5);
    }

    @Override
    public String metricName() {
        return "turbidity";
    }

    @Override
    public String unit() {
        return "NTU";
    }
}
