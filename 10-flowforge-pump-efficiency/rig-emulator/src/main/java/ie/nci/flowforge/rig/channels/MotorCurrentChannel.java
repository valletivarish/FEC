package ie.nci.flowforge.rig.channels;

public final class MotorCurrentChannel extends BoundedRandomWalkChannel {

    public MotorCurrentChannel() {
        super(8.0, 42.0, 1.2);
    }

    @Override
    public String metricName() {
        return "motor-current";
    }

    @Override
    public String unit() {
        return "A";
    }
}
