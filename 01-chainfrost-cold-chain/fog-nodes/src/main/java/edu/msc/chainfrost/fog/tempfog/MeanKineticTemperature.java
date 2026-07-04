package edu.msc.chainfrost.fog.tempfog;

import java.util.List;

/**
 * MKT weights higher excursions more heavily than a simple average, matching how
 * degradation actually accumulates in temperature-sensitive cargo (USP <1150> style).
 */
public final class MeanKineticTemperature {

    private static final double EA_OVER_R = 9455.7;
    private static final double CELSIUS_TO_KELVIN_OFFSET = 273.15;

    private MeanKineticTemperature() {
    }

    public static double computeCelsius(List<Double> temperaturesCelsius) {
        if (temperaturesCelsius == null || temperaturesCelsius.isEmpty()) {
            throw new IllegalArgumentException("temperaturesCelsius must not be empty");
        }
        double sumOfExpTerms = 0.0;
        for (double celsius : temperaturesCelsius) {
            double kelvin = celsius + CELSIUS_TO_KELVIN_OFFSET;
            sumOfExpTerms += Math.exp(-EA_OVER_R / kelvin);
        }
        double meanExpTerm = sumOfExpTerms / temperaturesCelsius.size();
        double mktKelvin = -EA_OVER_R / Math.log(meanExpTerm);
        return mktKelvin - CELSIUS_TO_KELVIN_OFFSET;
    }
}
