package edu.msc.floodwatch.gaugesim.generators;

public class WaterTemperatureGenerator extends AbstractBoundedWalkGenerator {

    public WaterTemperatureGenerator() {
        super(2, 24, 0.5);
    }

    @Override
    public String metricName() {
        return "water-temperature";
    }

    @Override
    public String unit() {
        return "degC";
    }
}
