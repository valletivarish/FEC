package edu.msc.floodwatch.gaugesim.generators;

public class SoilSaturationGenerator extends AbstractBoundedWalkGenerator {

    public SoilSaturationGenerator() {
        super(10, 100, 3);
    }

    @Override
    public String metricName() {
        return "soil-saturation";
    }

    @Override
    public String unit() {
        return "%VWC";
    }
}
