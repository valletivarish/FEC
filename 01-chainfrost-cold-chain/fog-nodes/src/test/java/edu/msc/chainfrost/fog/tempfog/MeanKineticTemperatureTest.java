package edu.msc.chainfrost.fog.tempfog;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertThrows;

import java.util.List;

import org.junit.jupiter.api.Test;

class MeanKineticTemperatureTest {

    private static final double DELTA = 0.05;

    @Test
    void constantTemperatureReturnsThatSameTemperature() {
        double mkt = MeanKineticTemperature.computeCelsius(List.of(-18.0, -18.0, -18.0));
        assertEquals(-18.0, mkt, DELTA);
    }

    @Test
    void mktIsBiasedAboveTheSimpleArithmeticMean() {
        List<Double> temperatures = List.of(-20.0, -20.0, -20.0, -20.0, 0.0);
        double simpleMean = temperatures.stream().mapToDouble(Double::doubleValue).average().orElseThrow();
        double mkt = MeanKineticTemperature.computeCelsius(temperatures);
        assertEquals(true, mkt > simpleMean, "MKT must weight the higher excursion more than a plain average");
    }

    @Test
    void knownReferenceValueForTypicalReeferExcursion() {
        // reference computed independently with Ea/R = 9455.7K on this fixture
        List<Double> temperatures = List.of(-18.0, -18.0, -15.0, -18.0, -18.0);
        double mkt = MeanKineticTemperature.computeCelsius(temperatures);
        assertEquals(-17.3, mkt, 0.2);
    }

    @Test
    void emptyListThrows() {
        assertThrows(IllegalArgumentException.class, () -> MeanKineticTemperature.computeCelsius(List.of()));
    }
}
