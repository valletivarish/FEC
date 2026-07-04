package com.guardianedge.sensorsim.config;

/** Per-metric sample vs. dispatch cadence, kept independent so a fast-sampled metric can still throttle its wire traffic. */
public final class MetricSchedule {

    private int sampleIntervalSeconds;
    private int dispatchIntervalSeconds;

    public MetricSchedule() {
    }

    public MetricSchedule(int sampleIntervalSeconds, int dispatchIntervalSeconds) {
        this.sampleIntervalSeconds = sampleIntervalSeconds;
        this.dispatchIntervalSeconds = dispatchIntervalSeconds;
    }

    public int getSampleIntervalSeconds() {
        return sampleIntervalSeconds;
    }

    public void setSampleIntervalSeconds(int sampleIntervalSeconds) {
        this.sampleIntervalSeconds = sampleIntervalSeconds;
    }

    public int getDispatchIntervalSeconds() {
        return dispatchIntervalSeconds;
    }

    public void setDispatchIntervalSeconds(int dispatchIntervalSeconds) {
        this.dispatchIntervalSeconds = dispatchIntervalSeconds;
    }
}
