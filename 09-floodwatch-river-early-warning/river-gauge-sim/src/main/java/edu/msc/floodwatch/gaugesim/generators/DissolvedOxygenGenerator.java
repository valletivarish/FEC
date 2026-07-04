package edu.msc.floodwatch.gaugesim.generators;

public class DissolvedOxygenGenerator extends AbstractBoundedWalkGenerator {

    public DissolvedOxygenGenerator() {
        super(3, 12, 0.4);
    }

    @Override
    public String metricName() {
        return "dissolved-oxygen";
    }

    @Override
    public String unit() {
        return "mg/L";
    }
}
