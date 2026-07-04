package edu.msc.floodwatch.gaugesim.generators;

import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.MethodSource;

import java.util.List;

import static org.junit.jupiter.api.Assertions.assertTrue;

class GeneratorBoundsTest {

    private static final int ITERATIONS = 5000;

    static List<Bounded> generators() {
        return List.of(
                new Bounded(new RiverLevelGenerator(), 0.2, 8.5),
                new Bounded(new FlowRateGenerator(), 0.5, 450),
                new Bounded(new RainfallGenerator(), 0, 60),
                new Bounded(new WaterTemperatureGenerator(), 2, 24),
                new Bounded(new TurbidityGenerator(), 1, 800),
                new Bounded(new DissolvedOxygenGenerator(), 3, 12),
                new Bounded(new PhGenerator(), 6.0, 8.5),
                new Bounded(new ConductivityGenerator(), 80, 900),
                new Bounded(new SoilSaturationGenerator(), 10, 100),
                new Bounded(new BarometricPressureGenerator(), 970, 1040)
        );
    }

    @ParameterizedTest
    @MethodSource("generators")
    void staysWithinBoundsAcrossManyIterations(Bounded bounded) {
        MetricGenerator generator = bounded.generator;
        double value = generator.initialValue();
        assertTrue(value >= bounded.min && value <= bounded.max,
                generator.metricName() + " initial value out of bounds: " + value);

        for (int i = 0; i < ITERATIONS; i++) {
            value = generator.nextValue(value);
            assertTrue(value >= bounded.min && value <= bounded.max,
                    generator.metricName() + " value out of bounds at iteration " + i + ": " + value);
        }
    }

    private record Bounded(MetricGenerator generator, double min, double max) {
    }
}
