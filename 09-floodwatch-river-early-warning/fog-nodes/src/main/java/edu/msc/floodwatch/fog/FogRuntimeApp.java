package edu.msc.floodwatch.fog;

import com.fasterxml.jackson.databind.ObjectMapper;
import edu.msc.floodwatch.fog.common.FogMetricsServer;
import edu.msc.floodwatch.fog.common.FogNodeRuntimeMetrics;
import edu.msc.floodwatch.fog.common.ReachEventDispatcher;
import edu.msc.floodwatch.fog.hydro.HydroFogNode;
import edu.msc.floodwatch.fog.meteo.CatchmentCorrelator;
import edu.msc.floodwatch.fog.meteo.MeteoFogNode;
import edu.msc.floodwatch.fog.quality.QualityFogNode;
import org.eclipse.paho.client.mqttv3.MqttClient;
import org.eclipse.paho.client.mqttv3.MqttConnectOptions;
import org.eclipse.paho.client.mqttv3.persist.MemoryPersistence;

import java.time.Instant;
import java.util.List;
import java.util.Map;
import java.util.Set;

/**
 * Wires the 3 fog node types across the 3 reaches to the shared MQTT broker and dispatches
 * every event they produce to the backend.
 */
public final class FogRuntimeApp {

    private static final List<String> REACH_IDS = List.of("reach-upper", "reach-mid", "reach-lower");
    private static final Set<String> HYDRO_METRICS = Set.of("river-level", "soil-saturation", "flow-rate");
    private static final Set<String> QUALITY_METRICS = Set.of(
            "turbidity", "water-temperature", "dissolved-oxygen", "ph", "conductivity");
    private static final Set<String> METEO_METRICS = Set.of("rainfall", "barometric-pressure");

    public static final FogNodeRuntimeMetrics HYDRO_METRICS_REPORT = new FogNodeRuntimeMetrics("HydroFogNode");
    public static final FogNodeRuntimeMetrics QUALITY_METRICS_REPORT = new FogNodeRuntimeMetrics("QualityFogNode");
    public static final FogNodeRuntimeMetrics METEO_METRICS_REPORT = new FogNodeRuntimeMetrics("MeteoFogNode");

    private FogRuntimeApp() {
    }

    public static void main(String[] args) throws Exception {
        String mqttBrokerUrl = System.getenv().getOrDefault("FLOODWATCH_MQTT_BROKER_URL", "tcp://localhost:1883");
        String apiBaseUrl = System.getenv().getOrDefault("FLOODWATCH_API_BASE_URL", "http://localhost:8080");
        int metricsPort = Integer.parseInt(System.getenv().getOrDefault("FLOODWATCH_FOG_METRICS_PORT", "8090"));

        ObjectMapper objectMapper = new ObjectMapper();
        ReachEventDispatcher dispatcher = new ReachEventDispatcher(apiBaseUrl);

        Map<String, HydroFogNode> hydroNodes = REACH_IDS.stream()
                .collect(java.util.stream.Collectors.toMap(id -> id, id -> new HydroFogNode()));

        CatchmentCorrelator correlator = new CatchmentCorrelator();

        Map<String, MeteoFogNode> meteoNodes = REACH_IDS.stream()
                .collect(java.util.stream.Collectors.toMap(
                        id -> id,
                        id -> new MeteoFogNode(id, correlator, hydroNodes.get(id))));

        Map<String, QualityFogNode> qualityNodes = REACH_IDS.stream()
                .collect(java.util.stream.Collectors.toMap(id -> id, id -> new QualityFogNode()));

        FogMetricsServer metricsServer = new FogMetricsServer(metricsPort,
                List.of(HYDRO_METRICS_REPORT, QUALITY_METRICS_REPORT, METEO_METRICS_REPORT));
        metricsServer.start();

        MqttClient mqttClient = new MqttClient(mqttBrokerUrl, MqttClient.generateClientId(), new MemoryPersistence());
        MqttConnectOptions options = new MqttConnectOptions();
        options.setAutomaticReconnect(true);
        options.setCleanSession(true);
        mqttClient.connect(options);

        mqttClient.subscribe("floodwatch/+/+", (topic, message) -> {
            Map<String, Object> reading = objectMapper.readValue(message.getPayload(), Map.class);
            routeReading(reading, hydroNodes, meteoNodes, qualityNodes, dispatcher);
        });
    }

    /**
     * Routes one sensor reading to the fog node type that owns its metric, dispatches any
     * resulting events, and self-reports real received/processed/sent/delay/queue metrics
     * for whichever node type handled it. Extracted from the MQTT callback so it is directly
     * unit-testable without a broker.
     */
    static void routeReading(Map<String, Object> reading, Map<String, HydroFogNode> hydroNodes,
            Map<String, MeteoFogNode> meteoNodes, Map<String, QualityFogNode> qualityNodes,
            ReachEventDispatcher dispatcher) {
        String reachId = (String) reading.get("reachId");
        String metric = (String) reading.get("metric");

        HydroFogNode hydroNode = hydroNodes.get(reachId);
        MeteoFogNode meteoNode = meteoNodes.get(reachId);
        QualityFogNode qualityNode = qualityNodes.get(reachId);
        if (hydroNode == null || meteoNode == null || qualityNode == null) {
            return;
        }

        FogNodeRuntimeMetrics metricsReport;
        List<Map<String, Object>> events;
        if (HYDRO_METRICS.contains(metric)) {
            metricsReport = HYDRO_METRICS_REPORT;
            metricsReport.onReadingReceived(reachId);
            events = hydroNode.onReading(reading);
        } else if (QUALITY_METRICS.contains(metric)) {
            metricsReport = QUALITY_METRICS_REPORT;
            metricsReport.onReadingReceived(reachId);
            events = qualityNode.onReading(reading);
        } else if (METEO_METRICS.contains(metric)) {
            metricsReport = METEO_METRICS_REPORT;
            metricsReport.onReadingReceived(reachId);
            events = meteoNode.onReading(reading);
        } else {
            return;
        }
        metricsReport.onReadingProcessed();

        Instant readingTimestamp = parseTimestamp(reading.get("timestamp"));
        for (Map<String, Object> event : events) {
            dispatcher.dispatch(event);
            metricsReport.onEventDispatched(readingTimestamp);
        }
    }

    private static Instant parseTimestamp(Object rawTimestamp) {
        if (rawTimestamp == null) {
            return null;
        }
        try {
            return Instant.parse(rawTimestamp.toString());
        } catch (Exception e) {
            return null;
        }
    }
}
