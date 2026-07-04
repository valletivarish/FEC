package binsight.emitters.transport;

import com.fasterxml.jackson.databind.ObjectMapper;
import org.eclipse.paho.client.mqttv3.MqttClient;
import org.eclipse.paho.client.mqttv3.MqttException;
import org.eclipse.paho.client.mqttv3.MqttMessage;
import org.eclipse.paho.client.mqttv3.persist.MemoryPersistence;

import java.time.Instant;
import java.util.LinkedHashMap;
import java.util.Map;
import java.util.UUID;

/** Publishes one reading as a JSON payload to binsight/{entityType}/{entityId}/{metric}. */
public class MqttReadingPublisher implements AutoCloseable {

    private final MqttClient client;
    private final ObjectMapper objectMapper = new ObjectMapper();

    public MqttReadingPublisher(String brokerUrl) throws MqttException {
        this.client = new MqttClient(brokerUrl, "binsight-emitter-" + UUID.randomUUID(), new MemoryPersistence());
        this.client.connect();
    }

    public void publish(String entityId, String entityType, String metric, Object value, String unit) throws MqttException {
        String topic = "binsight/" + entityType + "/" + entityId + "/" + metric;

        Map<String, Object> payload = new LinkedHashMap<>();
        payload.put("entityId", entityId);
        payload.put("entityType", entityType);
        payload.put("metric", metric);
        payload.put("value", value);
        payload.put("unit", unit);
        payload.put("timestamp", Instant.now().toString());

        byte[] body;
        try {
            body = objectMapper.writeValueAsBytes(payload);
        } catch (Exception e) {
            throw new MqttException(e);
        }

        MqttMessage message = new MqttMessage(body);
        message.setQos(0);
        client.publish(topic, message);
    }

    @Override
    public void close() throws MqttException {
        if (client.isConnected()) {
            client.disconnect();
        }
        client.close();
    }
}
