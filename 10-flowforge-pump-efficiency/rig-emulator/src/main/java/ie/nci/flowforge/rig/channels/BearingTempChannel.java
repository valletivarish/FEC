package ie.nci.flowforge.rig.channels;

public final class BearingTempChannel extends BoundedRandomWalkChannel {

    public BearingTempChannel() {
        super(35.0, 105.0, 1.5);
    }

    @Override
    public String metricName() {
        return "bearing-temp";
    }

    @Override
    public String unit() {
        return "degC";
    }
}
