package ie.nci.flowforge.rig.config;

/** Per-metric cadence; sampling and dispatch are separate so a channel can oversample locally. */
public class SensorScheduleConfig {

    private String metric;
    private int sampleIntervalSeconds;
    private int dispatchIntervalSeconds;

    public String getMetric() {
        return metric;
    }

    public void setMetric(String metric) {
        this.metric = metric;
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
