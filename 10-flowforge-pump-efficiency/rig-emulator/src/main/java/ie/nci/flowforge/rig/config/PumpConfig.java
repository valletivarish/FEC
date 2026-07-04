package ie.nci.flowforge.rig.config;

import java.util.ArrayList;
import java.util.List;

public class PumpConfig {

    private String pumpId;
    private String mqttBrokerUrl;
    private List<SensorScheduleConfig> sensors = new ArrayList<>();

    public String getPumpId() {
        return pumpId;
    }

    public void setPumpId(String pumpId) {
        this.pumpId = pumpId;
    }

    public String getMqttBrokerUrl() {
        return mqttBrokerUrl;
    }

    public void setMqttBrokerUrl(String mqttBrokerUrl) {
        this.mqttBrokerUrl = mqttBrokerUrl;
    }

    public List<SensorScheduleConfig> getSensors() {
        return sensors;
    }

    public void setSensors(List<SensorScheduleConfig> sensors) {
        this.sensors = sensors;
    }
}
