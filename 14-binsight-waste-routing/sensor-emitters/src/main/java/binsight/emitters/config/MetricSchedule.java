package binsight.emitters.config;

/** Per-metric cadence: how often a fresh value is sampled versus how often it is published over MQTT. */
public class MetricSchedule {

    private final String metric;
    private final int sampleIntervalSeconds;
    private final int dispatchIntervalSeconds;

    public MetricSchedule(String metric, int sampleIntervalSeconds, int dispatchIntervalSeconds) {
        this.metric = metric;
        this.sampleIntervalSeconds = sampleIntervalSeconds;
        this.dispatchIntervalSeconds = dispatchIntervalSeconds;
    }

    public String getMetric() {
        return metric;
    }

    public int getSampleIntervalSeconds() {
        return sampleIntervalSeconds;
    }

    public int getDispatchIntervalSeconds() {
        return dispatchIntervalSeconds;
    }
}
