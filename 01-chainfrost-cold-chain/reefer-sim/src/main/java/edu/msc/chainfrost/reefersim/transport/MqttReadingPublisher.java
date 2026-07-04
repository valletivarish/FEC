package edu.msc.chainfrost.reefersim.transport;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.datatype.jsr310.JavaTimeModule;
import edu.msc.chainfrost.reefersim.model.SensorReading;
import edu.msc.chainfrost.reefersim.simulation.SensorSimulator;
import org.eclipse.paho.client.mqttv3.MqttClient;
import org.eclipse.paho.client.mqttv3.MqttConnectOptions;
import org.eclipse.paho.client.mqttv3.MqttException;
import org.eclipse.paho.client.mqttv3.MqttMessage;
import org.eclipse.paho.client.mqttv3.persist.MemoryPersistence;

import java.io.IOException;
import java.util.Map;
import java.util.concurrent.ConcurrentHashMap;

/**
 * Publishes SensorReadings to MQTT_BROKER_URL as JSON, QoS 0. The GPS topic
 * is republished as a {lat,lon} object since that's its documented wire shape.
 */
public class MqttReadingPublisher implements AutoCloseable {

    private static final String GPS_TOPIC_SEGMENT = "telematics/gps";
    private static final long[] RECONNECT_BACKOFF_MS = {500, 1000, 2000, 5000};

    private final String truckId;
    private final String brokerUrl;
    private final ObjectMapper objectMapper;
    private final MqttClient client;

    // Tracks the simulator that owns the GPS topic so we can read its live longitude.
    private final Map<String, SensorSimulator> gpsSimulatorByTopic = new ConcurrentHashMap<>();

    public MqttReadingPublisher(String truckId) {
        this.truckId = truckId;
        this.brokerUrl = System.getenv().getOrDefault("MQTT_BROKER_URL", "tcp://localhost:1883");
        this.objectMapper = new ObjectMapper().registerModule(new JavaTimeModule());
        this.client = createClient();
        connectWithBackoff();
    }

    private MqttClient createClient() {
        try {
            String clientId = "chainfrost-sim-" + truckId;
            return new MqttClient(brokerUrl, clientId, new MemoryPersistence());
        } catch (MqttException e) {
            throw new IllegalStateException("Failed to create MQTT client for " + truckId, e);
        }
    }

    public void registerGpsSimulator(SensorSimulator gpsSimulator) {
        gpsSimulatorByTopic.put(gpsSimulator.profile().topic(), gpsSimulator);
    }

    private void connectWithBackoff() {
        MqttConnectOptions options = new MqttConnectOptions();
        options.setAutomaticReconnect(true);
        options.setCleanSession(true);
        options.setConnectionTimeout(10);

        for (long backoffMs : RECONNECT_BACKOFF_MS) {
            try {
                client.connect(options);
                return;
            } catch (MqttException e) {
                sleepQuietly(backoffMs);
            }
        }
        throw new IllegalStateException("Could not connect to MQTT broker at " + brokerUrl + " for " + truckId);
    }

    public void publish(SensorReading reading) {
        try {
            byte[] payload = buildPayload(reading);
            MqttMessage message = new MqttMessage(payload);
            message.setQos(0);
            if (!client.isConnected()) {
                connectWithBackoff();
            }
            client.publish(reading.topic(), message);
        } catch (MqttException | IOException e) {
            // Best-effort simulator: drop and continue rather than blocking the sample loop.
            System.err.println("Publish failed for " + reading.topic() + ": " + e.getMessage());
        }
    }

    private byte[] buildPayload(SensorReading reading) throws IOException {
        if (reading.topic().contains(GPS_TOPIC_SEGMENT)) {
            SensorSimulator gpsSimulator = gpsSimulatorByTopic.get(reading.topic());
            double lon = gpsSimulator != null ? gpsSimulator.currentLongitude() : 0.0;
            Map<String, Object> gpsPayload = Map.of("lat", reading.value(), "lon", lon);
            return objectMapper.writeValueAsBytes(gpsPayload);
        }
        return objectMapper.writeValueAsBytes(reading);
    }

    private void sleepQuietly(long millis) {
        try {
            Thread.sleep(millis);
        } catch (InterruptedException ie) {
            Thread.currentThread().interrupt();
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
            System.err.println("Error closing MQTT client for " + truckId + ": " + e.getMessage());
        }
    }
}
