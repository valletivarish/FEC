package edu.msc.chainfrost.fog.tempfog;

/**
 * Instantaneous excursion check only - sustained-breach logic (MKT over a
 * continuous window) lives in TempFogNode, which layers on top of this.
 */
public final class ExcursionRule {

    public static final double DEFAULT_TOLERANCE_CELSIUS = 2.0;

    private ExcursionRule() {
    }

    public static boolean isExcursionActive(double currentTempCelsius, double setpointCelsius) {
        return isExcursionActive(currentTempCelsius, setpointCelsius, DEFAULT_TOLERANCE_CELSIUS);
    }

    public static boolean isExcursionActive(double currentTempCelsius, double setpointCelsius, double toleranceCelsius) {
        return Math.abs(currentTempCelsius - setpointCelsius) > toleranceCelsius;
    }
}
