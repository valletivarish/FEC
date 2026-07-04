package com.guardianedge.sensorsim.model;

import java.util.Objects;

/** Wire-shape data class matching the MQTT JSON body every sensor publishes. */
public final class SensorReading {

    private String residentId;
    private String metric;
    private double value;
    private String unit;
    private String timestamp;

    public SensorReading() {
    }

    public SensorReading(String residentId, String metric, double value, String unit, String timestamp) {
        this.residentId = residentId;
        this.metric = metric;
        this.value = value;
        this.unit = unit;
        this.timestamp = timestamp;
    }

    public String getResidentId() {
        return residentId;
    }

    public void setResidentId(String residentId) {
        this.residentId = residentId;
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

    @Override
    public boolean equals(Object o) {
        if (this == o) {
            return true;
        }
        if (!(o instanceof SensorReading that)) {
            return false;
        }
        return Double.compare(value, that.value) == 0
                && Objects.equals(residentId, that.residentId)
                && Objects.equals(metric, that.metric)
                && Objects.equals(unit, that.unit)
                && Objects.equals(timestamp, that.timestamp);
    }

    @Override
    public int hashCode() {
        return Objects.hash(residentId, metric, value, unit, timestamp);
    }

    @Override
    public String toString() {
        return "SensorReading{residentId='%s', metric='%s', value=%s, unit='%s', timestamp='%s'}"
                .formatted(residentId, metric, value, unit, timestamp);
    }
}
