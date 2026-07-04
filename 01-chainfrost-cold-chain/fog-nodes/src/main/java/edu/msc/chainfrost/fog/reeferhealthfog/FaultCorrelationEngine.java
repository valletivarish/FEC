package edu.msc.chainfrost.fog.reeferhealthfog;

import java.time.Duration;
import java.time.Instant;
import java.util.Map;
import java.util.Optional;
import java.util.concurrent.ConcurrentHashMap;

/**
 * Correlation state machine: each check only fires once a condition has been
 * continuously true long enough that it is a real fault, not sensor noise.
 */
public class FaultCorrelationEngine {

    private static final Duration DOOR_OPEN_THRESHOLD = Duration.ofSeconds(90);
    private static final Duration COMPRESSOR_UNDERPERFORM_THRESHOLD = Duration.ofMinutes(5);
    private static final Duration COMPRESSOR_OVERLOAD_THRESHOLD = Duration.ofMinutes(3);

    private static final double COMPRESSOR_UNDERPERFORM_AMPS = 2.0;
    private static final double COMPRESSOR_OVERLOAD_AMPS = 15.0;
    private static final double TEMP_DEVIATION_THRESHOLD_CELSIUS = 3.0;
    private static final double BATTERY_DROP_RATE_PERCENT_PER_MINUTE = 1.5;

    // ambient RH above this is outside the reefer's normal 40-95% cycle band and points to a seal breach
    private static final double SEAL_BREACH_HUMIDITY_PERCENT = 85.0;

    private final TruckStateCache truckStateCache;
    private final Map<String, TruckFaultState> stateByTruck = new ConcurrentHashMap<>();

    public FaultCorrelationEngine(TruckStateCache truckStateCache) {
        this.truckStateCache = truckStateCache;
    }

    public void recordSpeed(String truckId, double speedKmh) {
        truckStateCache.recordSpeed(truckId, speedKmh);
    }

    public void recordZoneTemp(String truckId, double zoneTempCelsius) {
        state(truckId).lastZoneTempCelsius = zoneTempCelsius;
    }

    public void recordSetpoint(String truckId, double setpointCelsius) {
        state(truckId).lastSetpointCelsius = setpointCelsius;
    }

    public void recordHumidity(String truckId, double humidityPercent) {
        state(truckId).lastHumidityPercent = humidityPercent;
    }

    /** doorOpen true means the door is currently open at this reading's timestamp. */
    public Optional<FaultFinding> evaluateDoorState(String truckId, boolean doorOpen, Instant timestamp) {
        TruckFaultState state = state(truckId);
        if (!doorOpen) {
            state.doorOpenSince = null;
            return Optional.empty();
        }
        if (state.doorOpenSince == null) {
            state.doorOpenSince = timestamp;
        }
        Duration openFor = Duration.between(state.doorOpenSince, timestamp);
        if (openFor.compareTo(DOOR_OPEN_THRESHOLD) <= 0) {
            return Optional.empty();
        }
        double speed = truckStateCache.latestSpeed(truckId);
        boolean inTransit = speed != 0.0;
        double humidity = state.lastHumidityPercent;
        boolean humidityCorroboratesBreach = inTransit && !Double.isNaN(humidity) && humidity > SEAL_BREACH_HUMIDITY_PERCENT;

        FaultType faultType;
        if (!inTransit) {
            faultType = FaultType.LOADING_DOOR_OPEN;
        } else if (humidityCorroboratesBreach) {
            faultType = FaultType.SEAL_BREACH_SUSPECTED;
        } else {
            faultType = FaultType.DOOR_AJAR_IN_TRANSIT;
        }

        return Optional.of(new FaultFinding(
                faultType,
                state.doorOpenSince,
                Map.of("openForSeconds", openFor.toSeconds(), "speedKmh", speed, "humidityPercent", humidity)));
    }

    public Optional<FaultFinding> evaluateCompressorCurrent(String truckId, double amps, Instant timestamp) {
        TruckFaultState state = state(truckId);
        state.compressorActive = amps >= COMPRESSOR_UNDERPERFORM_AMPS;

        Optional<FaultFinding> overload = evaluateOverload(state, amps, timestamp);
        if (overload.isPresent()) {
            return overload;
        }
        return evaluateUnderperformance(state, amps, timestamp);
    }

    private Optional<FaultFinding> evaluateOverload(TruckFaultState state, double amps, Instant timestamp) {
        if (amps <= COMPRESSOR_OVERLOAD_AMPS) {
            state.compressorOverloadSince = null;
            return Optional.empty();
        }
        if (state.compressorOverloadSince == null) {
            state.compressorOverloadSince = timestamp;
        }
        Duration overFor = Duration.between(state.compressorOverloadSince, timestamp);
        if (overFor.compareTo(COMPRESSOR_OVERLOAD_THRESHOLD) < 0) {
            return Optional.empty();
        }
        return Optional.of(new FaultFinding(
                FaultType.COMPRESSOR_OVERLOAD,
                state.compressorOverloadSince,
                Map.of("compressorAmps", amps)));
    }

    private Optional<FaultFinding> evaluateUnderperformance(TruckFaultState state, double amps, Instant timestamp) {
        boolean tempDeviated = !Double.isNaN(state.lastZoneTempCelsius)
                && !Double.isNaN(state.lastSetpointCelsius)
                && (state.lastZoneTempCelsius - state.lastSetpointCelsius) > TEMP_DEVIATION_THRESHOLD_CELSIUS;

        if (amps >= COMPRESSOR_UNDERPERFORM_AMPS || !tempDeviated) {
            state.compressorUnderperformingSince = null;
            return Optional.empty();
        }
        if (state.compressorUnderperformingSince == null) {
            state.compressorUnderperformingSince = timestamp;
        }
        Duration underperformingFor = Duration.between(state.compressorUnderperformingSince, timestamp);
        if (underperformingFor.compareTo(COMPRESSOR_UNDERPERFORM_THRESHOLD) < 0) {
            return Optional.empty();
        }
        return Optional.of(new FaultFinding(
                FaultType.COMPRESSOR_UNDERPERFORMING,
                state.compressorUnderperformingSince,
                Map.of(
                        "compressorAmps", amps,
                        "zoneTempCelsius", state.lastZoneTempCelsius,
                        "setpointCelsius", state.lastSetpointCelsius)));
    }

    public Optional<FaultFinding> evaluateBatteryLevel(String truckId, double batteryLevelPercent, Instant timestamp) {
        TruckFaultState state = state(truckId);
        Optional<FaultFinding> finding = Optional.empty();

        if (state.previousBatteryLevel != null && state.previousBatteryTimestamp != null && state.compressorActive) {
            double elapsedMinutes = Duration.between(state.previousBatteryTimestamp, timestamp).toMillis() / 60000.0;
            if (elapsedMinutes > 0) {
                double dropPercent = state.previousBatteryLevel - batteryLevelPercent;
                double dropRatePerMinute = dropPercent / elapsedMinutes;
                if (dropRatePerMinute > BATTERY_DROP_RATE_PERCENT_PER_MINUTE) {
                    finding = Optional.of(new FaultFinding(
                            FaultType.BATTERY_DEGRADED,
                            state.previousBatteryTimestamp,
                            Map.of("dropRatePercentPerMinute", dropRatePerMinute, "batteryLevelPercent", batteryLevelPercent)));
                }
            }
        }

        state.previousBatteryLevel = batteryLevelPercent;
        state.previousBatteryTimestamp = timestamp;
        return finding;
    }

    private TruckFaultState state(String truckId) {
        return stateByTruck.computeIfAbsent(truckId, id -> new TruckFaultState());
    }
}
