package edu.msc.floodwatch.gaugesim.generators;

public class RiverLevelGenerator extends AbstractBoundedWalkGenerator {

    public RiverLevelGenerator() {
        super(0.2, 8.5, 0.3);
    }

    @Override
    public String metricName() {
        return "river-level";
    }

    @Override
    public String unit() {
        return "m";
    }
}
