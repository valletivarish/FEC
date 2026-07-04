package com.guardianedge.fog.vitalsfog;

import java.util.ArrayDeque;
import java.util.Deque;

/** Holds the last 20 RR intervals for one resident, used to derive SDNN. */
public class HrvWindowBuffer {

    private static final int MAX_SAMPLES = 20;

    private final Deque<Double> rrIntervalsMs = new ArrayDeque<>();
    private int readingsSinceRecompute = 0;

    public void addRrInterval(double rrMs) {
        rrIntervalsMs.addLast(rrMs);
        if (rrIntervalsMs.size() > MAX_SAMPLES) {
            rrIntervalsMs.removeFirst();
        }
        readingsSinceRecompute++;
    }

    public int size() {
        return rrIntervalsMs.size();
    }

    /** True every 6th reading, standing in for a real ~30s recompute cadence. */
    public boolean isRecomputeDue() {
        return readingsSinceRecompute >= 6;
    }

    public void markRecomputed() {
        readingsSinceRecompute = 0;
    }

    /** Sample standard deviation (n-1 denominator) of the buffered RR intervals, in ms. */
    public double computeSdnn() {
        double mean = rrIntervalsMs.stream().mapToDouble(Double::doubleValue).average().orElse(0.0);
        double sumSquaredDiff = rrIntervalsMs.stream()
                .mapToDouble(v -> (v - mean) * (v - mean))
                .sum();
        return Math.sqrt(sumSquaredDiff / (rrIntervalsMs.size() - 1));
    }
}
