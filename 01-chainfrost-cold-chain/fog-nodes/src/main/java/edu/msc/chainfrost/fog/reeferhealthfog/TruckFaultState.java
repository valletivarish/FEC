package edu.msc.chainfrost.fog.reeferhealthfog;

import java.time.Instant;

/**
 * Per-truck running state for the correlation checks: timers for how long a
 * condition has been continuously true, plus the last known readings needed
 * to evaluate cross-signal rules (e.g. zoneTemp vs setpoint).
 */
class TruckFaultState {

    Instant doorOpenSince;
    Instant compressorUnderperformingSince;
    Instant compressorOverloadSince;

    double lastZoneTempCelsius = Double.NaN;
    double lastSetpointCelsius = Double.NaN;
    double lastHumidityPercent = Double.NaN;
    boolean compressorActive;

    Double previousBatteryLevel;
    Instant previousBatteryTimestamp;
}
