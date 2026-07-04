package edu.msc.floodwatch.gaugesim.generators;

public class RainfallGenerator extends AbstractBoundedWalkGenerator {

    public RainfallGenerator() {
        super(0, 60, 4);
    }

    @Override
    public String metricName() {
        return "rainfall";
    }

    @Override
    public String unit() {
        return "mm/h";
    }
}
