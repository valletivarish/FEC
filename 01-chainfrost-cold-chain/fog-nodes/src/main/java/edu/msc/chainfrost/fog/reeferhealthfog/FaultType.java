package edu.msc.chainfrost.fog.reeferhealthfog;

/** LOADING_DOOR_OPEN is informational only; the rest are dispatched as REEFER_FAULT events. */
public enum FaultType {
    LOADING_DOOR_OPEN,
    DOOR_AJAR_IN_TRANSIT,
    // door ajar in transit plus ambient RH above the seal-breach threshold: not just open, actually failing
    SEAL_BREACH_SUSPECTED,
    COMPRESSOR_UNDERPERFORMING,
    COMPRESSOR_OVERLOAD,
    BATTERY_DEGRADED
}
