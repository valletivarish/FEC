package ie.nci.flowforge.rig.channels;

public final class RpmChannel extends BoundedRandomWalkChannel {

    public RpmChannel() {
        super(800.0, 2950.0, 40.0);
    }

    @Override
    public String metricName() {
        return "rpm";
    }

    @Override
    public String unit() {
        return "rpm";
    }
}
