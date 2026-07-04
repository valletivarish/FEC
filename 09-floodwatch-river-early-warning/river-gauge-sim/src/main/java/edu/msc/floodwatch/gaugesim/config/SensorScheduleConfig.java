package edu.msc.floodwatch.gaugesim.config;

/** Per-metric cadence: how often a fresh value is sampled vs. how often it is published. */
public class SensorScheduleConfig {

    private int sampleIntervalSeconds;
    private int dispatchIntervalSeconds;

    public SensorScheduleConfig() {
    }

    public SensorScheduleConfig(int sampleIntervalSeconds, int dispatchIntervalSeconds) {
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
