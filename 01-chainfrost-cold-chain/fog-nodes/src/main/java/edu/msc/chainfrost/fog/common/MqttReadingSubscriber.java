package edu.msc.chainfrost.fog.common;

import java.util.Map;
import java.util.concurrent.ConcurrentHashMap;
import java.util.function.BiConsumer;
import java.util.function.Consumer;

import org.eclipse.paho.client.mqttv3.MqttClient;
import org.eclipse.paho.client.mqttv3.MqttConnectOptions;
import org.eclipse.paho.client.mqttv3.MqttException;
import org.eclipse.paho.client.mqttv3.persist.MemoryPersistence;

import edu.msc.chainfrost.reefersim.model.SensorReading;

/**
 * Single MQTT connection shared by all fog nodes. Subscribes to every truck's
 * sensor traffic and fans each reading out by topic suffix (e.g. "reefer/zone1/temp")
 * so fog nodes can register interest without knowing the full topic string.
 */
public class MqttReadingSubscriber {

    private static final String TOPIC_FILTER = "chainfrost/+/#";
    private static final String DEFAULT_BROKER_URL = "tcp://localhost:1883";

    private final Map<String, Consumer<SensorReading>> consumersBySuffix = new ConcurrentHashMap<>();
    // gps payloads carry a {lat, lon} object rather than a scalar SensorReading.value,
    // so they are routed to the truckId + raw JSON node instead of the typed path.
    private final Map<String, BiConsumer<String, com.fasterxml.jackson.databind.JsonNode>> rawConsumersBySuffix =
            new ConcurrentHashMap<>();
    private final MqttClient mqttClient;

    public MqttReadingSubscriber() throws MqttException {
        this(resolveBrokerUrl());
    }

    public MqttReadingSubscriber(String brokerUrl) throws MqttException {
        String clientId = "chainfrost-fog-" + System.currentTimeMillis();
        this.mqttClient = new MqttClient(brokerUrl, clientId, new MemoryPersistence());
    }

    private static String resolveBrokerUrl() {
        String fromEnv = System.getenv("MQTT_BROKER_URL");
        return (fromEnv == null || fromEnv.isBlank()) ? DEFAULT_BROKER_URL : fromEnv;
    }

    /**
     * Registers interest in readings whose topic ends with the given suffix,
     * e.g. "reefer/zone1/temp" matches "chainfrost/truck-42/reefer/zone1/temp".
     */
    public void onTopicSuffix(String suffix, Consumer<SensorReading> consumer) {
        consumersBySuffix.put(suffix, consumer);
    }

    /** For topics like gps whose payload is a bare JSON object, not a SensorReading. */
    public void onRawTopicSuffix(String suffix, BiConsumer<String, com.fasterxml.jackson.databind.JsonNode> consumer) {
        rawConsumersBySuffix.put(suffix, consumer);
    }

    public void start() throws MqttException {
        MqttConnectOptions options = new MqttConnectOptions();
        options.setAutomaticReconnect(true);
        options.setCleanSession(true);
        mqttClient.connect(options);
        mqttClient.subscribe(TOPIC_FILTER, (topic, message) -> dispatch(topic, message.getPayload()));
    }

    private void dispatch(String topic, byte[] payload) {
        for (Map.Entry<String, BiConsumer<String, com.fasterxml.jackson.databind.JsonNode>> entry : rawConsumersBySuffix.entrySet()) {
            if (topic.endsWith(entry.getKey())) {
                dispatchRaw(topic, payload, entry.getValue());
                return;
            }
        }
        try {
            SensorReading reading = JsonSupport.MAPPER.readValue(payload, SensorReading.class);
            for (Map.Entry<String, Consumer<SensorReading>> entry : consumersBySuffix.entrySet()) {
                if (topic.endsWith(entry.getKey())) {
                    entry.getValue().accept(reading);
                }
            }
        } catch (Exception e) {
            // malformed payload on a single message must not take down the subscriber loop
        }
    }

    private void dispatchRaw(String topic, byte[] payload, BiConsumer<String, com.fasterxml.jackson.databind.JsonNode> consumer) {
        try {
            String truckId = extractTruckId(topic);
            com.fasterxml.jackson.databind.JsonNode node = JsonSupport.MAPPER.readTree(payload);
            consumer.accept(truckId, node);
        } catch (Exception e) {
            // malformed payload on a single message must not take down the subscriber loop
        }
    }

    private String extractTruckId(String topic) {
        String[] parts = topic.split("/");
        return parts.length > 1 ? parts[1] : topic;
    }

    public void stop() throws MqttException {
        if (mqttClient.isConnected()) {
            mqttClient.disconnect();
        }
        mqttClient.close();
    }
}
