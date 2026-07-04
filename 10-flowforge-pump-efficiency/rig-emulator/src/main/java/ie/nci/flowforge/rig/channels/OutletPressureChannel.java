package ie.nci.flowforge.rig.channels;

public final class OutletPressureChannel extends BoundedRandomWalkChannel {

    public OutletPressureChannel() {
        super(4.0, 16.0, 0.4);
    }

    @Override
    public String metricName() {
        return "outlet-pressure";
    }

    @Override
    public String unit() {
        return "bar";
    }
}
