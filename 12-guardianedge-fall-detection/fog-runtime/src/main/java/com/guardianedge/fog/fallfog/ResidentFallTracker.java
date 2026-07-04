package com.guardianedge.fog.fallfog;

import java.util.ArrayList;
import java.util.List;

/** Per-resident mutable FSM bookkeeping: current state plus the counters each state needs. */
class ResidentFallTracker {

    FallState state = FallState.MONITORING;
    int consecutiveFreeFallReadings = 0;
    int impactWindowReadingsLeft = 0;
    double impactAccelMagnitude = 0.0;
    final List<Double> stillnessGyroReadings = new ArrayList<>();

    void reset() {
        state = FallState.MONITORING;
        consecutiveFreeFallReadings = 0;
        impactWindowReadingsLeft = 0;
        impactAccelMagnitude = 0.0;
        stillnessGyroReadings.clear();
    }
}
