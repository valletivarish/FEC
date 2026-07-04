package com.guardianedge.sensorsim.mqtt;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.guardianedge.sensorsim.model.SensorReading;
import org.eclipse.paho.client.mqttv3.MqttClient;
import org.eclipse.paho.client.mqttv3.MqttConnectOptions;
import org.eclipse.paho.client.mqttv3.MqttException;
import org.eclipse.paho.client.mqttv3.MqttMessage;
import org.eclipse.paho.client.mqttv3.persist.MemoryPersistence;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

/** Publishes SensorReading JSON to guardianedge/{residentId}/{metric} over MQTT via the Paho client. */
public final class SensorMqttPublisher implements AutoCloseable {

    private static final Logger LOG = LoggerFactory.getLogger(SensorMqttPublisher.class);
    private static final int QOS_AT_LEAST_ONCE = 1;

    private final MqttClient client;
    private final ObjectMapper objectMapper = new ObjectMapper();

    public SensorMqttPublisher(String brokerUrl, String clientId) {
        try {
            this.client = new MqttClient(brokerUrl, clientId, new MemoryPersistence());
            MqttConnectOptions options = new MqttConnectOptions();
            options.setAutomaticReconnect(true);
            options.setCleanSession(true);
            client.connect(options);
        } catch (MqttException e) {
            throw new IllegalStateException("Failed to connect sensor-sim MQTT client to " + brokerUrl, e);
        }
    }

    public void publish(SensorReading reading) {
        String topic = "guardianedge/%s/%s".formatted(reading.getResidentId(), reading.getMetric());
        try {
            byte[] payload = objectMapper.writeValueAsBytes(reading);
            MqttMessage message = new MqttMessage(payload);
            message.setQos(QOS_AT_LEAST_ONCE);
            client.publish(topic, message);
        } catch (Exception e) {
            // A single dropped reading must not stop the rig; the next sample supersedes it anyway.
            LOG.warn("Failed to publish reading to {}", topic, e);
        }
    }

    @Override
    public void close() {
        try {
            if (client.isConnected()) {
                client.disconnect();
            }
            client.close();
        } catch (MqttException e) {
            LOG.warn("Error closing MQTT client", e);
        }
    }
}
