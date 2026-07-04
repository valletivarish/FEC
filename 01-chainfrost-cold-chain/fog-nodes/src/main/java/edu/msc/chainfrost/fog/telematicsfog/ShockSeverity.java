package edu.msc.chainfrost.fog.telematicsfog;

/** Bands calibrated so a pothole doesn't page anyone but a drop or collision does. */
public enum ShockSeverity {
    LOW,
    MEDIUM,
    HIGH;

    static ShockSeverity classify(double gForce) {
        if (gForce > 6.0) {
            return HIGH;
        }
        if (gForce > 4.0) {
            return MEDIUM;
        }
        return LOW;
    }
}
