package ie.nci.flowforge.rig.channels;

public final class FlowRateChannel extends BoundedRandomWalkChannel {

    public FlowRateChannel() {
        super(20.0, 450.0, 12.0);
    }

    @Override
    public String metricName() {
        return "flow-rate";
    }

    @Override
    public String unit() {
        return "m3/h";
    }
}
