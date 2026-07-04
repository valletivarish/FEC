package ie.nci.flowforge.rig.channels;

public final class PowerDrawChannel extends BoundedRandomWalkChannel {

    public PowerDrawChannel() {
        super(3.0, 75.0, 2.5);
    }

    @Override
    public String metricName() {
        return "power-draw";
    }

    @Override
    public String unit() {
        return "kW";
    }
}
