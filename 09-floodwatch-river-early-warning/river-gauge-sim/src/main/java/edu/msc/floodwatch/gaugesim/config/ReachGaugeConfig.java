package edu.msc.floodwatch.gaugesim.config;

import java.util.LinkedHashMap;
import java.util.Map;

/** Root of a per-reach YAML file: identity, broker location, and one schedule per metric. */
public class ReachGaugeConfig {

    private String reachId;
    private String mqttBrokerUrl;
    private Map<String, SensorScheduleConfig> sensors = new LinkedHashMap<>();

    public String getReachId() {
        return reachId;
    }

    public void setReachId(String reachId) {
        this.reachId = reachId;
    }

    public String getMqttBrokerUrl() {
        return mqttBrokerUrl;
    }

    public void setMqttBrokerUrl(String mqttBrokerUrl) {
        this.mqttBrokerUrl = mqttBrokerUrl;
    }

    public Map<String, SensorScheduleConfig> getSensors() {
        return sensors;
    }

    public void setSensors(Map<String, SensorScheduleConfig> sensors) {
        this.sensors = sensors;
    }
}
