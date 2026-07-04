package ie.nci.flowforge.rig.channels;

public final class InletPressureChannel extends BoundedRandomWalkChannel {

    public InletPressureChannel() {
        super(0.8, 3.5, 0.1);
    }

    @Override
    public String metricName() {
        return "inlet-pressure";
    }

    @Override
    public String unit() {
        return "bar";
    }
}
