package ie.nci.flowforge.rig.channels;

/** ISO 10816 alarm sits at 7.1 mm/s RMS; the range extends past it so the fog layer sees real trips. */
public final class VibrationChannel extends BoundedRandomWalkChannel {

    public VibrationChannel() {
        super(0.5, 12.0, 0.3);
    }

    @Override
    public String metricName() {
        return "vibration";
    }

    @Override
    public String unit() {
        return "mm/s";
    }
}
