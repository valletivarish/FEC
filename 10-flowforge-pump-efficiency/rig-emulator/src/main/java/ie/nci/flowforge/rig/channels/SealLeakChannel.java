package ie.nci.flowforge.rig.channels;

public final class SealLeakChannel extends BoundedRandomWalkChannel {

    public SealLeakChannel() {
        super(0.0, 50.0, 2.0);
    }

    @Override
    public String metricName() {
        return "seal-leak";
    }

    @Override
    public String unit() {
        return "mL/min";
    }
}
