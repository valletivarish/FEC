package edu.msc.chainfrost.fog.tempfog;

import java.time.Duration;
import java.time.Instant;
import java.util.Map;
import java.util.concurrent.ConcurrentHashMap;

import edu.msc.chainfrost.fog.common.FogEvent;
import edu.msc.chainfrost.fog.common.FogNodeMetrics;
import edu.msc.chainfrost.fog.common.KinesisDispatchClient;
import edu.msc.chainfrost.fog.common.ShipmentIds;
import edu.msc.chainfrost.reefersim.model.SensorReading;

/**
 * Tracks reefer zone temperatures per truck. Instantaneous excursions are cheap
 * to detect every reading; sustained breaches require a continuous 10-minute
 * window of MKT above tolerance, so we only alarm on real degradation risk.
 */
public class TempFogNode {

    private static final Duration SUSTAINED_BREACH_DURATION = Duration.ofMinutes(10);
    private static final Duration WARN_SUMMARY_INTERVAL = Duration.ofSeconds(60);

    private final KinesisDispatchClient dispatchClient;
    private final FogNodeMetrics metrics;
    private final Map<String, ZoneWindow> zone1WindowsByTruck = new ConcurrentHashMap<>();
    private final Map<String, ZoneWindow> zone2WindowsByTruck = new ConcurrentHashMap<>();

    public TempFogNode(KinesisDispatchClient dispatchClient) {
        this(dispatchClient, new FogNodeMetrics("TempFog"));
    }

    public TempFogNode(KinesisDispatchClient dispatchClient, FogNodeMetrics metrics) {
        this.dispatchClient = dispatchClient;
        this.metrics = metrics;
    }

    public FogNodeMetrics metrics() {
        return metrics;
    }

    /** Real in-memory buffer depth: readings currently held across every truck's rolling MKT windows. */
    public int queueSize() {
        int total = 0;
        for (ZoneWindow window : zone1WindowsByTruck.values()) {
            total += window.bufferedReadingCount();
        }
        for (ZoneWindow window : zone2WindowsByTruck.values()) {
            total += window.bufferedReadingCount();
        }
        return total;
    }

    public void onZone1Reading(SensorReading reading) {
        metrics.recordReceived();
        handleZoneReading("zone1", zone1WindowsByTruck, reading);
    }

    public void onZone2Reading(SensorReading reading) {
        metrics.recordReceived();
        handleZoneReading("zone2", zone2WindowsByTruck, reading);
    }

    public void onSetpointReading(SensorReading reading) {
        metrics.recordReceived();
        zone1WindowsByTruck.computeIfAbsent(reading.truckId(), id -> new ZoneWindow())
                .recordSetpoint(reading.value());
        zone2WindowsByTruck.computeIfAbsent(reading.truckId(), id -> new ZoneWindow())
                .recordSetpoint(reading.value());
        metrics.recordProcessed();
    }

    private void handleZoneReading(String zoneName, Map<String, ZoneWindow> windowsByTruck, SensorReading reading) {
        ZoneWindow window = windowsByTruck.computeIfAbsent(reading.truckId(), id -> new ZoneWindow());
        window.addReading(reading.value(), reading.timestamp());

        boolean instantaneousExcursion = ExcursionRule.isExcursionActive(reading.value(), window.setpoint());
        double mkt = MeanKineticTemperature.computeCelsius(window.temperaturesInWindow());
        boolean mktOverTolerance = mkt > window.setpoint() + ExcursionRule.DEFAULT_TOLERANCE_CELSIUS;

        if (mktOverTolerance) {
            window.markBreachStarted(reading.timestamp());
            Duration sustainedFor = Duration.between(window.breachStartedAt(), reading.timestamp());
            if (sustainedFor.compareTo(SUSTAINED_BREACH_DURATION) >= 0) {
                dispatchBreach(zoneName, reading, window, mkt);
            }
        } else {
            window.clearBreach();
        }

        if (instantaneousExcursion) {
            maybeDispatchWarnSummary(zoneName, reading, window, mkt);
        }
        metrics.recordProcessed();
    }

    private void dispatchBreach(String zoneName, SensorReading reading, ZoneWindow window, double mkt) {
        FogEvent event = new FogEvent(
                reading.truckId(),
                ShipmentIds.forTruckNow(reading.truckId()),
                "EXCURSION_BREACH",
                "BREACH",
                Map.of(
                        "zone", zoneName,
                        "currentTempCelsius", reading.value(),
                        "setpointCelsius", window.setpoint(),
                        "meanKineticTempCelsius", mkt,
                        "breachStartedAt", window.breachStartedAt().toString()),
                reading.timestamp());
        dispatchClient.dispatch(event);
        metrics.recordDispatched(reading.timestamp());
    }

    private void maybeDispatchWarnSummary(String zoneName, SensorReading reading, ZoneWindow window, double mkt) {
        Instant lastDispatched = window.lastWarnDispatchedAt();
        if (lastDispatched != null && Duration.between(lastDispatched, reading.timestamp()).compareTo(WARN_SUMMARY_INTERVAL) < 0) {
            return;
        }
        FogEvent event = new FogEvent(
                reading.truckId(),
                ShipmentIds.forTruckNow(reading.truckId()),
                "EXCURSION_WARN",
                "WARN",
                Map.of(
                        "zone", zoneName,
                        "currentTempCelsius", reading.value(),
                        "setpointCelsius", window.setpoint(),
                        "meanKineticTempCelsius", mkt),
                reading.timestamp());
        dispatchClient.dispatch(event);
        metrics.recordDispatched(reading.timestamp());
        window.markWarnDispatched(reading.timestamp());
    }
}
