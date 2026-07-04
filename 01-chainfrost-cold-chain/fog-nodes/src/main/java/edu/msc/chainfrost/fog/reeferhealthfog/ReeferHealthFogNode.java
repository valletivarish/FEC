package edu.msc.chainfrost.fog.reeferhealthfog;

import java.util.Map;
import java.util.Optional;
import java.util.Set;
import java.util.concurrent.ConcurrentHashMap;

import edu.msc.chainfrost.fog.common.FogEvent;
import edu.msc.chainfrost.fog.common.FogNodeMetrics;
import edu.msc.chainfrost.fog.common.KinesisDispatchClient;
import edu.msc.chainfrost.fog.common.ShipmentIds;
import edu.msc.chainfrost.reefersim.model.SensorReading;

/**
 * Feeds raw readings into FaultCorrelationEngine and dispatches REEFER_FAULT
 * events only on a state transition, using a dedupe key so a fault that stays
 * active across consecutive readings is not re-dispatched every time.
 */
public class ReeferHealthFogNode {

    private final FaultCorrelationEngine correlationEngine;
    private final KinesisDispatchClient dispatchClient;
    private final FogNodeMetrics metrics;
    private final Set<String> dispatchedDedupeKeys = ConcurrentHashMap.newKeySet();

    public ReeferHealthFogNode(KinesisDispatchClient dispatchClient) {
        this(dispatchClient, new FaultCorrelationEngine(new TruckStateCache()), new FogNodeMetrics("ReeferHealthFog"));
    }

    public ReeferHealthFogNode(KinesisDispatchClient dispatchClient, FogNodeMetrics metrics) {
        this(dispatchClient, new FaultCorrelationEngine(new TruckStateCache()), metrics);
    }

    ReeferHealthFogNode(KinesisDispatchClient dispatchClient, FaultCorrelationEngine correlationEngine) {
        this(dispatchClient, correlationEngine, new FogNodeMetrics("ReeferHealthFog"));
    }

    ReeferHealthFogNode(KinesisDispatchClient dispatchClient, FaultCorrelationEngine correlationEngine, FogNodeMetrics metrics) {
        this.dispatchClient = dispatchClient;
        this.correlationEngine = correlationEngine;
        this.metrics = metrics;
    }

    public FogNodeMetrics metrics() {
        return metrics;
    }

    /** Real queue depth: fault/status events parked in the shared Kinesis dispatch retry buffer. */
    public int queueSize() {
        return dispatchClient.fallbackQueueSize();
    }

    public void onSpeedReading(SensorReading reading) {
        metrics.recordReceived();
        correlationEngine.recordSpeed(reading.truckId(), reading.value());
        metrics.recordProcessed();
    }

    public void onZoneTempReading(SensorReading reading) {
        metrics.recordReceived();
        correlationEngine.recordZoneTemp(reading.truckId(), reading.value());
        metrics.recordProcessed();
    }

    public void onSetpointReading(SensorReading reading) {
        metrics.recordReceived();
        correlationEngine.recordSetpoint(reading.truckId(), reading.value());
        metrics.recordProcessed();
    }

    public void onDoorStateReading(SensorReading reading) {
        metrics.recordReceived();
        boolean doorOpen = reading.value() != 0.0;
        Optional<FaultFinding> finding = correlationEngine.evaluateDoorState(reading.truckId(), doorOpen, reading.timestamp());
        metrics.recordProcessed();
        finding.ifPresent(f -> dispatchIfNotInformational(reading.truckId(), f));
    }

    public void onCompressorCurrentReading(SensorReading reading) {
        metrics.recordReceived();
        Optional<FaultFinding> finding =
                correlationEngine.evaluateCompressorCurrent(reading.truckId(), reading.value(), reading.timestamp());
        metrics.recordProcessed();
        finding.ifPresent(f -> dispatchIfNotInformational(reading.truckId(), f));
    }

    public void onBatteryLevelReading(SensorReading reading) {
        metrics.recordReceived();
        Optional<FaultFinding> finding =
                correlationEngine.evaluateBatteryLevel(reading.truckId(), reading.value(), reading.timestamp());
        metrics.recordProcessed();
        finding.ifPresent(f -> dispatchIfNotInformational(reading.truckId(), f));
    }

    /**
     * Feeds the correlation engine (so a later door-ajar check can use it as seal-breach
     * evidence) and refreshes the shipment row's humidity reading independently of any fault.
     */
    public void onHumidityReading(SensorReading reading) {
        metrics.recordReceived();
        correlationEngine.recordHumidity(reading.truckId(), reading.value());
        FogEvent event = new FogEvent(
                reading.truckId(),
                ShipmentIds.forTruckNow(reading.truckId()),
                "REEFER_STATUS",
                "INFO",
                Map.of("humidityPct", reading.value()),
                reading.timestamp());
        dispatchClient.dispatch(event);
        metrics.recordProcessed();
        metrics.recordDispatched(reading.timestamp());
    }

    private void dispatchIfNotInformational(String truckId, FaultFinding finding) {
        if (finding.faultType() == FaultType.LOADING_DOOR_OPEN) {
            return;
        }
        String dedupeKey = truckId + ":" + finding.faultType() + ":" + finding.windowStart();
        if (!dispatchedDedupeKeys.add(dedupeKey)) {
            return;
        }
        String severity = finding.faultType() == FaultType.SEAL_BREACH_SUSPECTED ? "BREACH" : "WARN";
        FogEvent event = new FogEvent(
                truckId,
                ShipmentIds.forTruckNow(truckId),
                "REEFER_FAULT",
                severity,
                Map.of("faultType", finding.faultType().name(), "details", finding.details()),
                finding.windowStart());
        dispatchClient.dispatch(event);
        metrics.recordDispatched(finding.windowStart());
    }
}
