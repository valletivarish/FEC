package ie.nci.flowforge.fognodes;

import com.fasterxml.jackson.databind.ObjectMapper;
import ie.nci.flowforge.fn1health.HealthNode;
import ie.nci.flowforge.fn2hydraulics.HydraulicsNode;
import ie.nci.flowforge.fn3integrity.IntegrityNode;
import ie.nci.flowforge.fogcommon.FogMetricsServer;
import ie.nci.flowforge.fogcommon.FogNodeMetrics;
import ie.nci.flowforge.fogcommon.InsightDispatcher;
import org.eclipse.paho.client.mqttv3.MqttClient;
import org.eclipse.paho.client.mqttv3.MqttConnectOptions;
import org.eclipse.paho.client.mqttv3.MqttException;
import org.eclipse.paho.client.mqttv3.MqttMessage;
import org.eclipse.paho.client.mqttv3.persist.MemoryPersistence;

import java.util.List;
import java.util.Map;
import java.util.UUID;

/**
 * Runnable fog entrypoint: one shared instance per node TYPE (not per pump)
 * since each node already tracks per-pump state internally via its own maps.
 */
public final class FogRuntimeMain {

    private static final String READING_TOPIC_FILTER = "flowforge/+/+";
    private static final ObjectMapper OBJECT_MAPPER = new ObjectMapper();

    private FogRuntimeMain() {
    }

    public static void main(String[] args) throws MqttException {
        String brokerUrl = System.getenv().getOrDefault("FLOWFORGE_MQTT_BROKER_URL", "tcp://localhost:1883");
        String apiBaseUrl = System.getenv().getOrDefault("FLOWFORGE_API_BASE_URL", "http://localhost:8080");
        int metricsPort = Integer.parseInt(System.getenv().getOrDefault("FLOWFORGE_METRICS_PORT", "8103"));

        HealthNode healthNode = new HealthNode();
        HydraulicsNode hydraulicsNode = new HydraulicsNode();
        IntegrityNode integrityNode = new IntegrityNode();
        InsightDispatcher dispatcher = new InsightDispatcher(apiBaseUrl);

        FogNodeMetrics healthMetrics = new FogNodeMetrics("HealthNode");
        FogNodeMetrics hydraulicsMetrics = new FogNodeMetrics("HydraulicsNode");
        FogNodeMetrics integrityMetrics = new FogNodeMetrics("IntegrityNode");

        try {
            FogMetricsServer metricsServer = new FogMetricsServer(metricsPort,
                    List.of(healthMetrics, hydraulicsMetrics, integrityMetrics), dispatcher);
            metricsServer.start();
        } catch (java.io.IOException e) {
            // metrics port already bound (e.g. a second local run) must not stop fog processing itself
        }

        MqttClient client = new MqttClient(brokerUrl, "flowforge-fog-" + UUID.randomUUID(), new MemoryPersistence());
        MqttConnectOptions options = new MqttConnectOptions();
        options.setAutomaticReconnect(true);
        options.setCleanSession(true);

        client.setCallback(new FogMessageCallback(healthNode, hydraulicsNode, integrityNode, dispatcher,
                healthMetrics, hydraulicsMetrics, integrityMetrics));
        client.connect(options);
        client.subscribe(READING_TOPIC_FILTER);
    }

    /**
     * Routes every parsed reading to all 3 nodes; each node ignores metrics
     * it does not track, so a single fan-out here is sufficient.
     */
    private static final class FogMessageCallback implements org.eclipse.paho.client.mqttv3.MqttCallback {

        private final HealthNode healthNode;
        private final HydraulicsNode hydraulicsNode;
        private final IntegrityNode integrityNode;
        private final InsightDispatcher dispatcher;
        private final FogNodeMetrics healthMetrics;
        private final FogNodeMetrics hydraulicsMetrics;
        private final FogNodeMetrics integrityMetrics;

        private FogMessageCallback(HealthNode healthNode, HydraulicsNode hydraulicsNode,
                IntegrityNode integrityNode, InsightDispatcher dispatcher, FogNodeMetrics healthMetrics,
                FogNodeMetrics hydraulicsMetrics, FogNodeMetrics integrityMetrics) {
            this.healthNode = healthNode;
            this.hydraulicsNode = hydraulicsNode;
            this.integrityNode = integrityNode;
            this.dispatcher = dispatcher;
            this.healthMetrics = healthMetrics;
            this.hydraulicsMetrics = hydraulicsMetrics;
            this.integrityMetrics = integrityMetrics;
        }

        @Override
        public void connectionLost(Throwable cause) {
            // Paho's automatic reconnect handles retry; nothing to clean up here
        }

        @Override
        public void messageArrived(String topic, MqttMessage message) throws Exception {
            Map<String, Object> reading = OBJECT_MAPPER.readValue(message.getPayload(), Map.class);
            String readingTimestamp = String.valueOf(reading.get("timestamp"));

            runNode(healthNode::onReading, healthMetrics, reading, readingTimestamp);
            runNode(hydraulicsNode::onReading, hydraulicsMetrics, reading, readingTimestamp);
            runNode(integrityNode::onReading, integrityMetrics, reading, readingTimestamp);
        }

        @Override
        public void deliveryComplete(org.eclipse.paho.client.mqttv3.IMqttDeliveryToken token) {
            // fire-and-forget publishes only; nothing to acknowledge here
        }

        private void runNode(FogNodeReading node, FogNodeMetrics metrics, Map<String, Object> reading,
                String readingTimestamp) {
            metrics.recordReceived();
            List<Map<String, Object>> events = node.onReading(reading);
            metrics.recordProcessed(readingTimestamp);
            metrics.recordDispatched(events.size());
            for (Map<String, Object> event : events) {
                dispatcher.dispatch(event);
            }
        }
    }

    /** Lets the callback treat all 3 node types uniformly for metrics wiring without changing their APIs. */
    private interface FogNodeReading {
        List<Map<String, Object>> onReading(Map<String, Object> reading);
    }
}
