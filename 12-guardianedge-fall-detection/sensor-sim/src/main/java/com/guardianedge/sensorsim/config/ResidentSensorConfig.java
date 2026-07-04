package com.guardianedge.sensorsim.config;

import java.util.LinkedHashMap;
import java.util.Map;

/** Root shape of a resident-NN.yaml file: a resident id plus one schedule per metric name. */
public final class ResidentSensorConfig {

    private String residentId;
    private Map<String, MetricSchedule> metrics = new LinkedHashMap<>();

    public ResidentSensorConfig() {
    }

    public String getResidentId() {
        return residentId;
    }

    public void setResidentId(String residentId) {
        this.residentId = residentId;
    }

    public Map<String, MetricSchedule> getMetrics() {
        return metrics;
    }

    public void setMetrics(Map<String, MetricSchedule> metrics) {
        this.metrics = metrics;
    }

    public MetricSchedule scheduleFor(String metric) {
        MetricSchedule schedule = metrics.get(metric);
        if (schedule == null) {
            throw new IllegalArgumentException("No schedule configured for metric '" + metric + "' on " + residentId);
        }
        return schedule;
    }
}
