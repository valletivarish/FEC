package edu.msc.floodwatch.gaugesim.mqtt;

/** Wire shape matching the contract's MQTT JSON body: { reachId, metric, value, unit, timestamp }. */
public class SensorReading {

    private String reachId;
    private String metric;
    private double value;
    private String unit;
    private String timestamp;

    public SensorReading() {
    }

    public SensorReading(String reachId, String metric, double value, String unit, String timestamp) {
        this.reachId = reachId;
        this.metric = metric;
        this.value = value;
        this.unit = unit;
        this.timestamp = timestamp;
    }

    public String getReachId() {
        return reachId;
    }

    public void setReachId(String reachId) {
        this.reachId = reachId;
    }

    public String getMetric() {
        return metric;
    }

    public void setMetric(String metric) {
        this.metric = metric;
    }

    public double getValue() {
        return value;
    }

    public void setValue(double value) {
        this.value = value;
    }

    public String getUnit() {
        return unit;
    }

    public void setUnit(String unit) {
        this.unit = unit;
    }

    public String getTimestamp() {
        return timestamp;
    }

    public void setTimestamp(String timestamp) {
        this.timestamp = timestamp;
    }
}
