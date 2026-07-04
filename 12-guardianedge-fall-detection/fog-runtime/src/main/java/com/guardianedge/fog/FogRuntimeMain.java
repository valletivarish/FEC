package com.guardianedge.fog;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.guardianedge.fog.dispatch.EventDispatcher;
import com.guardianedge.fog.fallfog.FallFogNode;
import com.guardianedge.fog.metrics.FogMetricsServer;
import com.guardianedge.fog.metrics.FogNodeMetrics;
import com.guardianedge.fog.metrics.ProcessResourceSampler;
import com.guardianedge.fog.presencefog.PresenceFogNode;
import com.guardianedge.fog.vitalsfog.VitalsFogNode;
import org.eclipse.paho.client.mqttv3.MqttClient;
import org.eclipse.paho.client.mqttv3.MqttConnectOptions;
import org.eclipse.paho.client.mqttv3.MqttException;
import org.eclipse.paho.client.mqttv3.MqttMessage;
import org.eclipse.paho.client.mqttv3.persist.MemoryPersistence;

import java.io.IOException;
import java.util.List;
import java.util.Map;

/**
 * Runnable entrypoint wiring one shared instance of each fog node type (per-resident state
 * lives inside each node) to the MQTT broker and the backend event dispatcher.
 */
public final class FogRuntimeMain {

    private static final String READING_TOPIC_FILTER = "guardianedge/+/+";

    public static void main(String[] args) throws MqttException, IOException {
        String brokerUrl = System.getenv().getOrDefault("MQTT_BROKER_URL", "tcp://localhost:1883");
        String apiBaseUrl = System.getenv().getOrDefault("GUARDIANEDGE_API_BASE_URL", "http://localhost:8080");
        int metricsPort = Integer.parseInt(System.getenv().getOrDefault("FOG_METRICS_PORT", "8180"));
        String clientId = "guardianedge-fog-runtime-" + System.currentTimeMillis();

        ObjectMapper objectMapper = new ObjectMapper();
        EventDispatcher dispatcher = new EventDispatcher(apiBaseUrl);

        VitalsFogNode vitalsFogNode = new VitalsFogNode();
        FallFogNode fallFogNode = new FallFogNode();
        PresenceFogNode presenceFogNode = new PresenceFogNode();

        FogNodeMetrics vitalsMetrics = new FogNodeMetrics("VitalsFogNode");
        FogNodeMetrics fallMetrics = new FogNodeMetrics("FallFogNode");
        FogNodeMetrics presenceMetrics = new FogNodeMetrics("PresenceFogNode");
        ProcessResourceSampler resourceSampler = new ProcessResourceSampler();

        FogMetricsServer metricsServer = new FogMetricsServer(metricsPort,
                List.of(vitalsMetrics, fallMetrics, presenceMetrics), resourceSampler, dispatcher);
        metricsServer.start();

        MqttClient client = new MqttClient(brokerUrl, clientId, new MemoryPersistence());
        client.setCallback(new ReadingCallback(objectMapper, dispatcher, vitalsFogNode, fallFogNode, presenceFogNode,
                vitalsMetrics, fallMetrics, presenceMetrics));

        MqttConnectOptions options = new MqttConnectOptions();
        options.setAutomaticReconnect(true);
        options.setCleanSession(true);
        client.connect(options);
        client.subscribe(READING_TOPIC_FILTER);
    }

    private FogRuntimeMain() {
    }

    /** Routes each parsed reading to all 3 fog nodes; each node ignores metrics it doesn't track. */
    private static class ReadingCallback implements org.eclipse.paho.client.mqttv3.MqttCallback {

        private final ObjectMapper objectMapper;
        private final EventDispatcher dispatcher;
        private final VitalsFogNode vitalsFogNode;
        private final FallFogNode fallFogNode;
        private final PresenceFogNode presenceFogNode;
        private final FogNodeMetrics vitalsMetrics;
        private final FogNodeMetrics fallMetrics;
        private final FogNodeMetrics presenceMetrics;

        ReadingCallback(ObjectMapper objectMapper, EventDispatcher dispatcher, VitalsFogNode vitalsFogNode,
                        FallFogNode fallFogNode, PresenceFogNode presenceFogNode, FogNodeMetrics vitalsMetrics,
                        FogNodeMetrics fallMetrics, FogNodeMetrics presenceMetrics) {
            this.objectMapper = objectMapper;
            this.dispatcher = dispatcher;
            this.vitalsFogNode = vitalsFogNode;
            this.fallFogNode = fallFogNode;
            this.presenceFogNode = presenceFogNode;
            this.vitalsMetrics = vitalsMetrics;
            this.fallMetrics = fallMetrics;
            this.presenceMetrics = presenceMetrics;
        }

        @Override
        public void connectionLost(Throwable cause) {
            System.err.println("MQTT connection lost: " + cause.getMessage());
        }

        @Override
        public void messageArrived(String topic, MqttMessage message) {
            try {
                Map<String, Object> reading = objectMapper.readValue(message.getPayload(), Map.class);
                String readingTimestamp = (String) reading.get("timestamp");

                runNode(vitalsMetrics, () -> vitalsFogNode.onReading(reading), readingTimestamp);
                runNode(fallMetrics, () -> fallFogNode.onReading(reading), readingTimestamp);
                runNode(presenceMetrics, () -> presenceFogNode.onReading(reading), readingTimestamp);
            } catch (Exception e) {
                // A single malformed reading must not take down the runtime's MQTT loop.
                System.err.println("Failed to process reading on topic " + topic + ": " + e.getMessage());
            }
        }

        @Override
        public void deliveryComplete(org.eclipse.paho.client.mqttv3.IMqttDeliveryToken token) {
            // No outbound MQTT publishes from this runtime; nothing to confirm.
        }

        /** Runs one node's real processing logic and records the counters/delay that logic actually produced. */
        private void runNode(FogNodeMetrics metrics, java.util.function.Supplier<List<Map<String, Object>>> onReading,
                              String readingTimestamp) {
            metrics.recordReceived();
            List<Map<String, Object>> events = onReading.get();
            metrics.recordProcessed();
            if (readingTimestamp != null) {
                metrics.recordProcessingDelay(readingTimestamp);
            }
            dispatchAll(events);
            metrics.recordDispatched(events.size());
        }

        private void dispatchAll(List<Map<String, Object>> events) {
            for (Map<String, Object> event : events) {
                dispatcher.dispatch(event);
            }
        }
    }
}
