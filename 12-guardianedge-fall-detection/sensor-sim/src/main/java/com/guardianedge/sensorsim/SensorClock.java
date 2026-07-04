package com.guardianedge.sensorsim;

import com.guardianedge.sensorsim.model.SensorReading;
import java.util.concurrent.Executors;
import java.util.concurrent.ScheduledExecutorService;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicReference;
import java.util.function.Consumer;
import java.util.function.Supplier;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

/**
 * Drives one metric's sample-vs-dispatch cadence independently of every other metric.
 * A sampler thread refreshes the latest reading every sampleIntervalSeconds; a separate
 * dispatch thread republishes whatever is currently latest every dispatchIntervalSeconds,
 * so the two rates never have to be equal or share a divisor.
 */
public final class SensorClock {

    private static final Logger LOG = LoggerFactory.getLogger(SensorClock.class);

    private final ScheduledExecutorService scheduler;

    public SensorClock(int threadPoolSize) {
        this.scheduler = Executors.newScheduledThreadPool(threadPoolSize);
    }

    /** Schedules one metric's sample and dispatch loops; returns immediately, work continues on the pool. */
    public void scheduleMetric(String metricName, int sampleIntervalSeconds, int dispatchIntervalSeconds,
                                Supplier<SensorReading> sampler, Consumer<SensorReading> dispatcher) {
        AtomicReference<SensorReading> latest = new AtomicReference<>();

        scheduler.scheduleAtFixedRate(() -> {
            try {
                latest.set(sampler.get());
            } catch (RuntimeException e) {
                LOG.warn("Sampler failed for metric {}", metricName, e);
            }
        }, 0, sampleIntervalSeconds, TimeUnit.SECONDS);

        scheduler.scheduleAtFixedRate(() -> {
            SensorReading reading = latest.get();
            if (reading == null) {
                return;
            }
            try {
                dispatcher.accept(reading);
            } catch (RuntimeException e) {
                LOG.warn("Dispatch failed for metric {}", metricName, e);
            }
        }, dispatchIntervalSeconds, dispatchIntervalSeconds, TimeUnit.SECONDS);
    }

    public void shutdown() {
        scheduler.shutdown();
        try {
            if (!scheduler.awaitTermination(5, TimeUnit.SECONDS)) {
                scheduler.shutdownNow();
            }
        } catch (InterruptedException e) {
            scheduler.shutdownNow();
            Thread.currentThread().interrupt();
        }
    }
}
