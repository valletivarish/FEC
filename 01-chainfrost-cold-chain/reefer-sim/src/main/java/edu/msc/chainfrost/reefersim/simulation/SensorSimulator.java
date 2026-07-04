package edu.msc.chainfrost.reefersim.simulation;

import edu.msc.chainfrost.reefersim.config.SensorProfile;
import edu.msc.chainfrost.reefersim.model.SensorReading;

import java.time.Instant;
import java.util.ArrayList;
import java.util.List;
import java.util.Random;
import java.util.concurrent.ScheduledExecutorService;
import java.util.concurrent.ScheduledFuture;
import java.util.concurrent.TimeUnit;
import java.util.function.Consumer;

/**
 * Generates readings for a single (truck, sensor) pair on its own sample
 * cadence, buffers them, and flushes the buffer to a consumer on a
 * separately configurable dispatch cadence.
 *
 * GPS is the one topic whose wire payload is a lat/lon JSON object rather than
 * a scalar; SensorReading.value carries latitude and currentLongitude() exposes
 * the paired longitude so MqttReadingPublisher can build the {lat,lon} JSON.
 */
public class SensorSimulator {

    private final String truckId;
    private final SensorProfile profile;
    private final ScheduledExecutorService executor;
    private final Consumer<SensorReading> dispatchConsumer;
    private final Random random;

    private final List<SensorReading> buffer = new ArrayList<>();
    private final Object bufferLock = new Object();

    // Running state carried between ticks so walks/cycles evolve smoothly.
    private double lastValue;
    private double lastLat = 43.6532;
    private double lastLon = -79.3832;

    private ScheduledFuture<?> sampleTask;
    private ScheduledFuture<?> dispatchTask;

    public SensorSimulator(String truckId, SensorProfile profile, ScheduledExecutorService executor,
                            Consumer<SensorReading> dispatchConsumer) {
        this(truckId, profile, executor, dispatchConsumer, new Random());
    }

    public SensorSimulator(String truckId, SensorProfile profile, ScheduledExecutorService executor,
                            Consumer<SensorReading> dispatchConsumer, Random random) {
        this.truckId = truckId;
        this.profile = profile;
        this.executor = executor;
        this.dispatchConsumer = dispatchConsumer;
        this.random = random;
        // BOOLEAN_FLICKER must start at a real 0/1 state, not the midpoint used by other models.
        this.lastValue = "BOOLEAN_FLICKER".equals(profile.valueModel())
                ? profile.min()
                : (profile.min() + profile.max()) / 2.0;
    }

    public void start() {
        sampleTask = executor.scheduleAtFixedRate(this::sampleTick,
                0, profile.sampleFrequencyMs(), TimeUnit.MILLISECONDS);
        dispatchTask = executor.scheduleAtFixedRate(this::flush,
                profile.dispatchRateMs(), profile.dispatchRateMs(), TimeUnit.MILLISECONDS);
    }

    public void stop() {
        if (sampleTask != null) {
            sampleTask.cancel(false);
        }
        if (dispatchTask != null) {
            dispatchTask.cancel(false);
        }
    }

    private void sampleTick() {
        double value = nextValue();
        SensorReading reading = new SensorReading(truckId, profile.topic(), value, Instant.now());
        synchronized (bufferLock) {
            buffer.add(reading);
        }
    }

    private void flush() {
        List<SensorReading> toSend;
        synchronized (bufferLock) {
            if (buffer.isEmpty()) {
                return;
            }
            toSend = new ArrayList<>(buffer);
            buffer.clear();
        }
        for (SensorReading reading : toSend) {
            dispatchConsumer.accept(reading);
        }
    }

    // Package-visible for tests to sample the value model without scheduling.
    double nextValue() {
        return switch (profile.valueModel()) {
            case "RANDOM_WALK" -> randomWalk();
            case "DIURNAL_CYCLE" -> diurnalCycle();
            case "BOOLEAN_FLICKER" -> booleanFlicker();
            case "GPS_RANDOM_WALK" -> gpsRandomWalk();
            default -> throw new IllegalArgumentException("Unknown valueModel: " + profile.valueModel());
        };
    }

    private double randomWalk() {
        double range = profile.max() - profile.min();
        double step = (random.nextDouble() - 0.5) * range * 0.05;
        // Shock sensors are biased low with rare spikes; reusing the generic random
        // walk with an occasional larger jump avoids a bespoke value model.
        if (profile.topic().contains("shock") && random.nextDouble() < 0.02) {
            step += range * 0.4;
        }
        lastValue = clamp(lastValue + step);
        return lastValue;
    }

    private double diurnalCycle() {
        double mid = (profile.min() + profile.max()) / 2.0;
        double amplitude = (profile.max() - profile.min()) / 2.0;
        double secondsOfDay = (Instant.now().getEpochSecond() % 86400);
        double phase = (secondsOfDay / 86400.0) * 2 * Math.PI;
        double noise = (random.nextDouble() - 0.5) * amplitude * 0.1;
        double value = mid + amplitude * Math.sin(phase) + noise;
        lastValue = clamp(value);
        return lastValue;
    }

    private double booleanFlicker() {
        double flipProbability = 0.05;
        if (random.nextDouble() < flipProbability) {
            lastValue = lastValue == 0.0 ? 1.0 : 0.0;
        }
        return lastValue;
    }

    // Latitude is returned as the sampled scalar value; longitude is tracked
    // alongside and read via currentLongitude() when building the GPS JSON payload.
    private double gpsRandomWalk() {
        double stepDegrees = 0.0015;
        lastLat += (random.nextDouble() - 0.5) * stepDegrees;
        lastLon += (random.nextDouble() - 0.5) * stepDegrees;
        return lastLat;
    }

    public double currentLongitude() {
        return lastLon;
    }

    private double clamp(double value) {
        return Math.max(profile.min(), Math.min(profile.max(), value));
    }

    public SensorProfile profile() {
        return profile;
    }
}
