package com.guardianedge.fog.fallfog;

/** Five-state fall-detection FSM driven by accelerometer and gyroscope readings. */
public enum FallState {
    MONITORING,
    FREE_FALL,
    IMPACT,
    STILLNESS_CONFIRM,
    FALL_CONFIRMED
}
