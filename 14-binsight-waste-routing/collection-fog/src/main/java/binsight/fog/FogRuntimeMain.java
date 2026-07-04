package binsight.fog;

import binsight.fog.bincluster.BinClusterNode;
import binsight.fog.binsafety.BinSafetyNode;
import binsight.fog.dispatch.BinSightEventDispatcher;
import binsight.fog.fleet.FleetNode;
import binsight.fog.model.SensorReading;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.eclipse.paho.client.mqttv3.MqttClient;
import org.eclipse.paho.client.mqttv3.persist.MemoryPersistence;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

import java.time.Instant;
import java.util.HashMap;
import java.util.List;
import java.util.Map;

/**
 * Runnable fog-layer entrypoint: subscribes to all sensor topics, fans each reading out
 * to the fog node(s) that own that metric, and wires the cross-node event flow that makes
 * FleetNode's work-list genuinely informed.
 */
public class FogRuntimeMain {

    private static final Logger LOG = LoggerFactory.getLogger(FogRuntimeMain.class);

    public static void main(String[] args) throws Exception {
        String mqttBrokerUrl = System.getenv().getOrDefault("BINSIGHT_MQTT_BROKER_URL", "tcp://localhost:1883");
        String apiBaseUrl = System.getenv().getOrDefault("BINSIGHT_API_BASE_URL", "http://localhost:8080");

        BinClusterNode binClusterNode = new BinClusterNode();
        BinSafetyNode binSafetyNode = new BinSafetyNode();
        FleetNode fleetNode = new FleetNode(binLocations(), initialLastCollectedTimestamps());
        BinSightEventDispatcher dispatcher = new BinSightEventDispatcher(apiBaseUrl);
        ObjectMapper objectMapper = new ObjectMapper();

        MqttClient mqttClient = new MqttClient(mqttBrokerUrl, "binsight-collection-fog", new MemoryPersistence());
        mqttClient.connect();

        mqttClient.subscribe("binsight/+/+/+", (topic, message) -> {
            try {
                SensorReading reading = parseReading(objectMapper, message.getPayload());
                route(reading, binClusterNode, binSafetyNode, fleetNode, dispatcher);
            } catch (Exception e) {
                LOG.warn("Failed to process message on topic {}", topic, e);
            }
        });

        LOG.info("BinSight collection-fog runtime subscribed to binsight/+/+/+");
    }

    // Bins are stationary and their location isn't itself a sensor stream in this simulation.
    private static Map<String, double[]> binLocations() {
        Map<String, double[]> locations = new HashMap<>();
        locations.put("bin-01", new double[] {53.3498, -6.2603});
        locations.put("bin-02", new double[] {53.3521, -6.2664});
        locations.put("bin-03", new double[] {53.3462, -6.2551});
        return locations;
    }

    // Staggered so at least one bin starts clearly overdue (>72h) and one does not.
    private static Map<String, Long> initialLastCollectedTimestamps() {
        long now = Instant.now().toEpochMilli();
        Map<String, Long> timestamps = new HashMap<>();
        timestamps.put("bin-01", now - (96L * 3600_000L));
        timestamps.put("bin-02", now - (12L * 3600_000L));
        timestamps.put("bin-03", now - (30L * 3600_000L));
        return timestamps;
    }

    private static SensorReading parseReading(ObjectMapper objectMapper, byte[] payload) throws Exception {
        JsonNode node = objectMapper.readTree(payload);
        String metric = node.get("metric").asText();

        Object value;
        if (metric.equals("truck-gps")) {
            JsonNode valueNode = node.get("value");
            Map<String, Object> gps = new HashMap<>();
            gps.put("lat", valueNode.get("lat").asDouble());
            gps.put("lon", valueNode.get("lon").asDouble());
            gps.put("headingDeg", valueNode.get("headingDeg").asDouble());
            value = gps;
        } else if (metric.equals("lid-state")) {
            value = node.get("value").asText();
        } else {
            value = node.get("value").asDouble();
        }

        return new SensorReading(
                node.get("entityId").asText(),
                node.get("entityType").asText(),
                metric,
                value,
                node.has("unit") ? node.get("unit").asText() : null,
                node.get("timestamp").asText());
    }

    private static void route(SensorReading reading, BinClusterNode binClusterNode, BinSafetyNode binSafetyNode,
                               FleetNode fleetNode, BinSightEventDispatcher dispatcher) {
        String metric = reading.getMetric();

        switch (metric) {
            case "fill-level":
            case "bin-weight":
                dispatchAll(binClusterNode.onReading(reading), fleetNode, dispatcher);
                dispatchAll(fleetNode.onReading(reading), fleetNode, dispatcher);
                break;
            case "lid-state":
                dispatchAll(binClusterNode.onReading(reading), fleetNode, dispatcher);
                break;
            case "methane-ppm":
            case "internal-temp":
            case "tilt":
                dispatchAll(binSafetyNode.onReading(reading), fleetNode, dispatcher);
                break;
            case "truck-gps":
            case "hopper-fill":
            case "fuel-level":
            case "weighbridge-tonnage":
                dispatchAll(fleetNode.onReading(reading), fleetNode, dispatcher);
                break;
            default:
                LOG.debug("Ignoring reading for unrecognised metric {}", metric);
        }
    }

    // Cluster verdicts and fire-risk alerts feed FleetNode in-process before being dispatched,
    // so the work-list reflects the latest cross-node context, not just raw sensor values.
    private static void dispatchAll(List<Map<String, Object>> events, FleetNode fleetNode, BinSightEventDispatcher dispatcher) {
        for (Map<String, Object> event : events) {
            dispatcher.dispatch(event);

            String type = (String) event.get("type");
            if ("cluster_verdict".equals(type)) {
                dispatchAll(fleetNode.onBinClusterVerdict(event), fleetNode, dispatcher);
            } else if ("fire_risk_alert".equals(type)) {
                dispatchAll(fleetNode.onBinSafetyAlert(event), fleetNode, dispatcher);
            }
        }
    }
}
