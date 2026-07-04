package ie.nci.flowforge.fogcommon;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.sun.net.httpserver.HttpServer;

import java.io.IOException;
import java.io.OutputStream;
import java.net.InetSocketAddress;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

/**
 * Serves GET /metrics with this fog runtime's real per-node counters, JVM CPU/memory, and
 * dispatcher queue depth as JSON, so the dashboard's Fog Node page reads live process state
 * instead of a static number. Runs on the same lightweight com.sun.net.httpserver stack already
 * proven by InsightDispatcherTest, so no new dependency is needed.
 */
public class FogMetricsServer {

    private static final long ACTIVE_WINDOW_MILLIS = 30_000L;

    private final HttpServer server;
    private final ObjectMapper objectMapper = new ObjectMapper();

    public FogMetricsServer(int port, List<FogNodeMetrics> nodeMetrics, InsightDispatcher dispatcher) throws IOException {
        server = HttpServer.create(new InetSocketAddress(port), 0);
        server.createContext("/metrics", exchange -> {
            byte[] body = objectMapper.writeValueAsBytes(buildPayload(nodeMetrics, dispatcher));
            exchange.getResponseHeaders().add("Content-Type", "application/json");
            exchange.getResponseHeaders().add("Access-Control-Allow-Origin", "*");
            exchange.sendResponseHeaders(200, body.length);
            try (OutputStream responseBody = exchange.getResponseBody()) {
                responseBody.write(body);
            }
        });
        server.setExecutor(null);
    }

    private Map<String, Object> buildPayload(List<FogNodeMetrics> nodeMetrics, InsightDispatcher dispatcher) {
        Map<String, Object> payload = new LinkedHashMap<>();
        payload.put("cpuUsagePercent", FogProcessStats.cpuUsagePercent());
        payload.put("usedHeapBytes", FogProcessStats.usedHeapBytes());
        payload.put("maxHeapBytes", FogProcessStats.maxHeapBytes());
        payload.put("queueSize", dispatcher.pendingQueueSize());

        List<Map<String, Object>> nodes = nodeMetrics.stream().map(metrics -> {
            Map<String, Object> nodeJson = new LinkedHashMap<>();
            nodeJson.put("nodeName", metrics.getNodeName());
            nodeJson.put("receivedCount", metrics.getReceivedCount());
            nodeJson.put("processedCount", metrics.getProcessedCount());
            nodeJson.put("dispatchedCount", metrics.getDispatchedCount());
            nodeJson.put("lastProcessingDelayMillis", metrics.getLastProcessingDelayMillis());
            nodeJson.put("status", metrics.isActiveWithinMillis(ACTIVE_WINDOW_MILLIS) ? "Running" : "Idle");
            return nodeJson;
        }).toList();
        payload.put("nodes", nodes);

        return payload;
    }

    public void start() {
        server.start();
    }

    public void stop() {
        server.stop(0);
    }

    public int getPort() {
        return server.getAddress().getPort();
    }
}
