package ie.nci.flowforge.rig.mqtt;

import com.fasterxml.jackson.databind.ObjectMapper;
import org.eclipse.paho.client.mqttv3.MqttClient;
import org.eclipse.paho.client.mqttv3.MqttConnectOptions;
import org.eclipse.paho.client.mqttv3.MqttException;
import org.eclipse.paho.client.mqttv3.MqttMessage;
import org.eclipse.paho.client.mqttv3.persist.MemoryPersistence;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

/** One shared client per rig process; topic per publish call matches flowforge/{pumpId}/{metric}. */
public class MqttReadingPublisher implements AutoCloseable {

    private static final Logger LOG = LoggerFactory.getLogger(MqttReadingPublisher.class);
    private static final int QOS_AT_LEAST_ONCE = 1;

    private final MqttClient client;
    private final ObjectMapper objectMapper = new ObjectMapper();

    public MqttReadingPublisher(String brokerUrl, String clientId) {
        try {
            this.client = new MqttClient(brokerUrl, clientId, new MemoryPersistence());
            MqttConnectOptions options = new MqttConnectOptions();
            options.setAutomaticReconnect(true);
            options.setCleanSession(true);
            client.connect(options);
        } catch (MqttException e) {
            throw new IllegalStateException("Failed to connect MQTT client to " + brokerUrl, e);
        }
    }

    public void publish(SensorReading reading) {
        String topic = "flowforge/" + reading.getPumpId() + "/" + reading.getMetric();
        try {
            byte[] payload = objectMapper.writeValueAsBytes(reading);
            MqttMessage message = new MqttMessage(payload);
            message.setQos(QOS_AT_LEAST_ONCE);
            client.publish(topic, message);
        } catch (Exception e) {
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
            LOG.warn("Failed to close MQTT client cleanly", e);
        }
    }
}
