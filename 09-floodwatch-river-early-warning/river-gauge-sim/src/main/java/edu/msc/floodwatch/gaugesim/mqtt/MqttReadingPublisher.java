package edu.msc.floodwatch.gaugesim.mqtt;

import com.fasterxml.jackson.databind.ObjectMapper;
import org.eclipse.paho.client.mqttv3.MqttClient;
import org.eclipse.paho.client.mqttv3.MqttConnectOptions;
import org.eclipse.paho.client.mqttv3.MqttException;
import org.eclipse.paho.client.mqttv3.MqttMessage;
import org.eclipse.paho.client.mqttv3.persist.MemoryPersistence;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

/** Publishes a SensorReading as JSON to floodwatch/{reachId}/{metric}, the exact topic the fog layer subscribes to. */
public class MqttReadingPublisher implements AutoCloseable {

    private static final Logger LOG = LoggerFactory.getLogger(MqttReadingPublisher.class);
    private static final int QOS_AT_LEAST_ONCE = 1;

    private final MqttClient client;
    private final ObjectMapper objectMapper = new ObjectMapper();

    public MqttReadingPublisher(String brokerUrl, String clientId) throws MqttException {
        this.client = new MqttClient(brokerUrl, clientId, new MemoryPersistence());
        MqttConnectOptions options = new MqttConnectOptions();
        options.setAutomaticReconnect(true);
        options.setCleanSession(true);
        client.connect(options);
    }

    public void publish(SensorReading reading) {
        String topic = "floodwatch/" + reading.getReachId() + "/" + reading.getMetric();
        try {
            byte[] payload = objectMapper.writeValueAsBytes(reading);
            MqttMessage message = new MqttMessage(payload);
            message.setQos(QOS_AT_LEAST_ONCE);
            client.publish(topic, message);
        } catch (Exception e) {
            // A dropped reading is acceptable for a simulator; the next sample cycle will retry.
            LOG.warn("Failed to publish reading to {}: {}", topic, e.getMessage());
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
            LOG.warn("Error closing MQTT client: {}", e.getMessage());
        }
    }
}
