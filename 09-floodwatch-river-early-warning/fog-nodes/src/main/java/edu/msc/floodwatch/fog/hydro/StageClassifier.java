package edu.msc.floodwatch.fog.hydro;

/**
 * Maps a river-level reading to a flood stage. Saturated ground sheds rainfall faster,
 * so the same river level is riskier and the thresholds shift down.
 */
final class StageClassifier {

    private static final double AMBER_THRESHOLD = 3.0;
    private static final double RED_THRESHOLD = 5.0;
    private static final double AMBER_THRESHOLD_SATURATED = 2.5;
    private static final double RED_THRESHOLD_SATURATED = 4.5;
    private static final double SATURATION_AMPLIFY_THRESHOLD = 85.0;

    private StageClassifier() {
    }

    static Stage classify(double riverLevel, double latestSoilSaturation) {
        boolean amplified = latestSoilSaturation > SATURATION_AMPLIFY_THRESHOLD;
        double amberThreshold = amplified ? AMBER_THRESHOLD_SATURATED : AMBER_THRESHOLD;
        double redThreshold = amplified ? RED_THRESHOLD_SATURATED : RED_THRESHOLD;

        if (riverLevel > redThreshold) {
            return Stage.RED;
        }
        if (riverLevel >= amberThreshold) {
            return Stage.AMBER;
        }
        return Stage.GREEN;
    }

    static boolean isAmplified(double latestSoilSaturation) {
        return latestSoilSaturation > SATURATION_AMPLIFY_THRESHOLD;
    }
}
