package com.guardianedge.fog.metrics;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.guardianedge.fog.dispatch.EventDispatcher;
import com.sun.net.httpserver.HttpServer;

import java.io.IOException;
import java.io.OutputStream;
import java.net.InetSocketAddress;
import java.nio.charset.StandardCharsets;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

/**
 * Serves a JSON snapshot of every fog node's counters and this process's own CPU/memory at
 * GET /metrics, so the dashboard's Fog Node page can show real, not fabricated, operational state.
 */
public class FogMetricsServer {

    private final HttpServer server;
    private final ObjectMapper objectMapper = new ObjectMapper();

    public FogMetricsServer(int port, List<FogNodeMetrics> nodeMetrics, ProcessResourceSampler resourceSampler,
                             EventDispatcher dispatcher) throws IOException {
        server = HttpServer.create(new InetSocketAddress(port), 0);
        server.createContext("/metrics", exchange -> {
            byte[] body = objectMapper.writeValueAsBytes(snapshot(nodeMetrics, resourceSampler, dispatcher));
            exchange.getResponseHeaders().add("Content-Type", "application/json");
            exchange.sendResponseHeaders(200, body.length);
            try (OutputStream responseBody = exchange.getResponseBody()) {
                responseBody.write(body);
            }
        });
        server.createContext("/health", exchange -> {
            byte[] body = "{\"status\":\"UP\"}".getBytes(StandardCharsets.UTF_8);
            exchange.getResponseHeaders().add("Content-Type", "application/json");
            exchange.sendResponseHeaders(200, body.length);
            try (OutputStream responseBody = exchange.getResponseBody()) {
                responseBody.write(body);
            }
        });
        server.setExecutor(null);
    }

    public void start() {
        server.start();
    }

    public void stop() {
        server.stop(0);
    }

    private Map<String, Object> snapshot(List<FogNodeMetrics> nodeMetrics, ProcessResourceSampler resourceSampler,
                                          EventDispatcher dispatcher) {
        Map<String, Object> payload = new LinkedHashMap<>();
        payload.put("cpuUsagePercent", round(resourceSampler.cpuUsagePercent()));
        payload.put("usedMemoryBytes", resourceSampler.usedMemoryBytes());
        payload.put("maxMemoryBytes", resourceSampler.maxMemoryBytes());
        payload.put("queueSize", dispatcher.queueSize());

        List<Map<String, Object>> nodes = nodeMetrics.stream().map(this::nodeSnapshot).toList();
        payload.put("nodes", nodes);
        return payload;
    }

    private Map<String, Object> nodeSnapshot(FogNodeMetrics metrics) {
        Map<String, Object> node = new LinkedHashMap<>();
        node.put("nodeName", metrics.getNodeName());
        node.put("receivedCount", metrics.getReceivedCount());
        node.put("processedCount", metrics.getProcessedCount());
        node.put("dispatchedCount", metrics.getDispatchedCount());
        node.put("lastProcessingDelayMillis", metrics.getLastProcessingDelayMillis());
        return node;
    }

    private double round(double value) {
        return Math.round(value * 100.0) / 100.0;
    }
}
