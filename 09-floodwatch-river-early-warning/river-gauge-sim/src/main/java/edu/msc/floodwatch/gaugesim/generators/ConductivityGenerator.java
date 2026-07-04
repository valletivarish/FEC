package edu.msc.floodwatch.gaugesim.generators;

public class ConductivityGenerator extends AbstractBoundedWalkGenerator {

    public ConductivityGenerator() {
        super(80, 900, 30);
    }

    @Override
    public String metricName() {
        return "conductivity";
    }

    @Override
    public String unit() {
        return "uS/cm";
    }
}
