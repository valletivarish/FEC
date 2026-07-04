package edu.msc.floodwatch.fog.common;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.sun.net.httpserver.HttpServer;

import java.io.IOException;
import java.io.OutputStream;
import java.net.InetSocketAddress;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

/**
 * Serves GET /fog-metrics with a live JSON snapshot of every wired FogNodeRuntimeMetrics
 * instance, using the JDK's built-in HttpServer so the dashboard's Fog Node page can poll
 * real process state without adding a web framework dependency to this module.
 */
public final class FogMetricsServer {

    private final HttpServer httpServer;
    private final ObjectMapper objectMapper = new ObjectMapper();

    public FogMetricsServer(int port, List<FogNodeRuntimeMetrics> nodeMetrics) throws IOException {
        httpServer = HttpServer.create(new InetSocketAddress(port), 0);
        httpServer.createContext("/fog-metrics", exchange -> {
            byte[] responseBody = objectMapper.writeValueAsBytes(snapshot(nodeMetrics));
            exchange.getResponseHeaders().add("Content-Type", "application/json");
            exchange.getResponseHeaders().add("Access-Control-Allow-Origin", "*");
            exchange.sendResponseHeaders(200, responseBody.length);
            try (OutputStream body = exchange.getResponseBody()) {
                body.write(responseBody);
            }
        });
        httpServer.setExecutor(null);
    }

    public void start() {
        httpServer.start();
    }

    public void stop() {
        httpServer.stop(0);
    }

    private Map<String, Object> snapshot(List<FogNodeRuntimeMetrics> nodeMetrics) {
        Map<String, Object> body = new LinkedHashMap<>();
        body.put("cpuLoad", FogNodeRuntimeMetrics.processCpuLoad());
        body.put("memoryUsedMb", FogNodeRuntimeMetrics.usedMemoryMb());

        List<Map<String, Object>> nodes = nodeMetrics.stream().map(metrics -> {
            Map<String, Object> node = new LinkedHashMap<>();
            node.put("nodeName", metrics.nodeName());
            node.put("status", metrics.status());
            node.put("messagesReceived", metrics.messagesReceived());
            node.put("messagesProcessed", metrics.messagesProcessed());
            node.put("messagesSent", metrics.messagesSent());
            node.put("queueDepth", metrics.queueDepth());
            node.put("lastProcessingDelayMillis", metrics.lastProcessingDelayMillis());
            return node;
        }).toList();
        body.put("nodes", nodes);
        return body;
    }
}
