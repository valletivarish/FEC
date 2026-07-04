package edu.msc.floodwatch.gaugesim.generators;

import java.util.LinkedHashMap;
import java.util.Map;
import java.util.function.Supplier;

/** Maps the 10 contract metric names to a fresh generator instance each, one map to keep in sync with the contract. */
public final class MetricGeneratorFactory {

    private static final Map<String, Supplier<MetricGenerator>> SUPPLIERS = new LinkedHashMap<>();

    static {
        SUPPLIERS.put("river-level", RiverLevelGenerator::new);
        SUPPLIERS.put("flow-rate", FlowRateGenerator::new);
        SUPPLIERS.put("rainfall", RainfallGenerator::new);
        SUPPLIERS.put("water-temperature", WaterTemperatureGenerator::new);
        SUPPLIERS.put("turbidity", TurbidityGenerator::new);
        SUPPLIERS.put("dissolved-oxygen", DissolvedOxygenGenerator::new);
        SUPPLIERS.put("ph", PhGenerator::new);
        SUPPLIERS.put("conductivity", ConductivityGenerator::new);
        SUPPLIERS.put("soil-saturation", SoilSaturationGenerator::new);
        SUPPLIERS.put("barometric-pressure", BarometricPressureGenerator::new);
    }

    private MetricGeneratorFactory() {
    }

    public static MetricGenerator create(String metricName) {
        Supplier<MetricGenerator> supplier = SUPPLIERS.get(metricName);
        if (supplier == null) {
            throw new IllegalArgumentException("Unknown metric: " + metricName);
        }
        return supplier.get();
    }

    public static Iterable<String> allMetricNames() {
        return SUPPLIERS.keySet();
    }
}
