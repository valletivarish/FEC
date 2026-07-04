package edu.msc.floodwatch.gaugesim.generators;

public class TurbidityGenerator extends AbstractBoundedWalkGenerator {

    public TurbidityGenerator() {
        super(1, 800, 40);
    }

    @Override
    public String metricName() {
        return "turbidity";
    }

    @Override
    public String unit() {
        return "NTU";
    }
}
