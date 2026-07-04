package edu.msc.chainfrost.fog.telematicsfog;

import java.time.Duration;
import java.time.Instant;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.Executors;
import java.util.concurrent.ScheduledExecutorService;
import java.util.concurrent.TimeUnit;

import com.fasterxml.jackson.databind.JsonNode;

import edu.msc.chainfrost.fog.common.FogEvent;
import edu.msc.chainfrost.fog.common.FogNodeMetrics;
import edu.msc.chainfrost.fog.common.KinesisDispatchClient;
import edu.msc.chainfrost.fog.common.ShipmentIds;
import edu.msc.chainfrost.reefersim.model.SensorReading;

/**
 * Batches thinned GPS pings into periodic route updates but ships shock events
 * immediately - a hard jolt is time-sensitive in a way a route trace is not.
 */
public class TelematicsFogNode {

    private static final Duration ROUTE_BATCH_INTERVAL = Duration.ofSeconds(60);
    private static final double SHOCK_DISPATCH_THRESHOLD_G = 2.5;

    private final KinesisDispatchClient dispatchClient;
    private final FogNodeMetrics metrics;
    private final GpsThinner gpsThinner = new GpsThinner();
    private final Map<String, Double> latestSpeedByTruck = new ConcurrentHashMap<>();
    private final Map<String, List<RoutePing>> pendingRoutePingsByTruck = new ConcurrentHashMap<>();
    private final ScheduledExecutorService batchExecutor = Executors.newSingleThreadScheduledExecutor(runnable -> {
        Thread thread = new Thread(runnable, "telematics-route-batcher");
        thread.setDaemon(true);
        return thread;
    });

    public TelematicsFogNode(KinesisDispatchClient dispatchClient) {
        this(dispatchClient, new FogNodeMetrics("TelematicsFog"));
    }

    public TelematicsFogNode(KinesisDispatchClient dispatchClient, FogNodeMetrics metrics) {
        this.dispatchClient = dispatchClient;
        this.metrics = metrics;
        batchExecutor.scheduleWithFixedDelay(
                this::flushAllRouteBatches, ROUTE_BATCH_INTERVAL.toSeconds(), ROUTE_BATCH_INTERVAL.toSeconds(), TimeUnit.SECONDS);
    }

    public FogNodeMetrics metrics() {
        return metrics;
    }

    /** Real in-memory buffer depth: thinned GPS pings waiting for the next batch flush. */
    public int queueSize() {
        return pendingRoutePingsByTruck.values().stream().mapToInt(List::size).sum();
    }

    public void onSpeedReading(SensorReading reading) {
        metrics.recordReceived();
        latestSpeedByTruck.put(reading.truckId(), reading.value());
        metrics.recordProcessed();
    }

    public void onGpsReading(String truckId, JsonNode payload) {
        metrics.recordReceived();
        double lat = payload.get("lat").asDouble();
        double lon = payload.get("lon").asDouble();
        double speed = latestSpeedByTruck.getOrDefault(truckId, 0.0);
        GpsPoint point = new GpsPoint(lat, lon, speed, Instant.now());

        Optional<GpsPoint> thinned = gpsThinner.offer(truckId, point);
        thinned.ifPresent(p -> pendingRoutePingsByTruck
                .computeIfAbsent(truckId, id -> new ArrayList<>())
                .add(RoutePing.from(p)));
        metrics.recordProcessed();
    }

    public void onShockReading(SensorReading reading) {
        metrics.recordReceived();
        if (reading.value() <= SHOCK_DISPATCH_THRESHOLD_G) {
            metrics.recordProcessed();
            return;
        }
        ShockSeverity severity = ShockSeverity.classify(reading.value());
        FogEvent event = new FogEvent(
                reading.truckId(),
                ShipmentIds.forTruckNow(reading.truckId()),
                "TELEMATICS_SHOCK",
                "WARN",
                Map.of("gForce", reading.value(), "shockSeverity", severity.name()),
                reading.timestamp());
        dispatchClient.dispatch(event);
        metrics.recordProcessed();
        metrics.recordDispatched(reading.timestamp());
    }

    private void flushAllRouteBatches() {
        for (String truckId : pendingRoutePingsByTruck.keySet()) {
            flushRouteBatch(truckId);
        }
    }

    private void flushRouteBatch(String truckId) {
        List<RoutePing> pings = pendingRoutePingsByTruck.remove(truckId);
        if (pings == null || pings.isEmpty()) {
            return;
        }
        FogEvent event = new FogEvent(
                truckId,
                ShipmentIds.forTruckNow(truckId),
                "TELEMATICS_ROUTE",
                "INFO",
                Map.of("routePings", pings),
                Instant.now());
        dispatchClient.dispatch(event);
        metrics.recordDispatched(Instant.now());
    }

    public void shutdown() {
        batchExecutor.shutdownNow();
    }
}
