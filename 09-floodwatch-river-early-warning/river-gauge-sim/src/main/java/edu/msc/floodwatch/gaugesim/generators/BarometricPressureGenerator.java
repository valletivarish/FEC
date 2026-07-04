package edu.msc.floodwatch.gaugesim.generators;

public class BarometricPressureGenerator extends AbstractBoundedWalkGenerator {

    public BarometricPressureGenerator() {
        super(970, 1040, 2);
    }

    @Override
    public String metricName() {
        return "barometric-pressure";
    }

    @Override
    public String unit() {
        return "hPa";
    }
}
