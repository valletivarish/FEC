package edu.msc.floodwatch.gaugesim.generators;

public class PhGenerator extends AbstractBoundedWalkGenerator {

    public PhGenerator() {
        super(6.0, 8.5, 0.15);
    }

    @Override
    public String metricName() {
        return "ph";
    }

    @Override
    public String unit() {
        return "pH";
    }
}
