package edu.msc.floodwatch.gaugesim.generators;

public class FlowRateGenerator extends AbstractBoundedWalkGenerator {

    public FlowRateGenerator() {
        super(0.5, 450, 25);
    }

    @Override
    public String metricName() {
        return "flow-rate";
    }

    @Override
    public String unit() {
        return "m3/s";
    }
}
