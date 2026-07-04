package com.guardianedge.fog.vitalsfog;

/** Outer (WARNING-trigger) and inner (CRITICAL-debounce) alert bands for one vital. */
final class VitalThresholds {

    final double outerLow;
    final double outerHigh;
    final double innerLow;
    final double innerHigh;

    private VitalThresholds(double outerLow, double outerHigh, double innerLow, double innerHigh) {
        this.outerLow = outerLow;
        this.outerHigh = outerHigh;
        this.innerLow = innerLow;
        this.innerHigh = innerHigh;
    }

    /** spo2 has no separate inner band: any outer breach counts toward the 3-consecutive escalation. */
    boolean breachesInner(double value) {
        return value < innerLow || value > innerHigh;
    }

    boolean withinOuterSafeRange(double value) {
        return value >= outerLow && value <= outerHigh;
    }

    static VitalThresholds heartrate() {
        return new VitalThresholds(45, 130, 50, 125);
    }

    static VitalThresholds spo2() {
        // Only a low bound is alert-banded; inner mirrors outer since spo2 has no separate inner band.
        return new VitalThresholds(90, Double.MAX_VALUE, 90, Double.MAX_VALUE);
    }

    static VitalThresholds resprate() {
        return new VitalThresholds(8, 28, 9, 26);
    }

    static VitalThresholds skintemp() {
        return new VitalThresholds(34.5, 38.5, 35.0, 38.0);
    }
}
