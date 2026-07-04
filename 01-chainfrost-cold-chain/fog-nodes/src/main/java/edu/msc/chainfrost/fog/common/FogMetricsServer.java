package edu.msc.chainfrost.fog.common;

import java.io.IOException;
import java.io.OutputStream;
import java.net.InetSocketAddress;
import java.util.LinkedHashMap;
import java.util.Map;
import java.util.function.IntSupplier;

import com.sun.net.httpserver.HttpServer;

/**
 * Tiny built-in-JDK HTTP server exposing one fog node's live self-reported metrics as JSON
 * on GET /metrics. Each of the three fog nodes gets its own instance/port since they share a
 * single JVM process but must report independently real per-node numbers to the dashboard.
 */
public class FogMetricsServer {

    private final HttpServer server;
    private final FogNodeMetrics metrics;
    private final IntSupplier queueSizeSupplier;

    public FogMetricsServer(int port, FogNodeMetrics metrics, IntSupplier queueSizeSupplier) throws IOException {
        this.metrics = metrics;
        this.queueSizeSupplier = queueSizeSupplier;
        this.server = HttpServer.create(new InetSocketAddress(port), 0);
        server.createContext("/metrics", this::handleMetrics);
        server.setExecutor(null);
    }

    public void start() {
        server.start();
    }

    public void stop() {
        server.stop(0);
    }

    private void handleMetrics(com.sun.net.httpserver.HttpExchange exchange) throws IOException {
        Map<String, Object> body = new LinkedHashMap<>();
        body.put("nodeName", metrics.nodeName());
        body.put("status", metrics.status());
        body.put("cpuUsagePercent", round2(metrics.cpuUsagePercent()));
        body.put("memoryUsedBytes", metrics.memoryUsedBytes());
        body.put("memoryMaxBytes", metrics.memoryMaxBytes());
        body.put("messagesReceived", metrics.receivedCount());
        body.put("messagesProcessed", metrics.processedCount());
        body.put("messagesSentToCloud", metrics.dispatchedCount());
        body.put("processingDelayMillis", metrics.processingDelayMillis());
        body.put("queueSize", queueSizeSupplier.getAsInt());

        byte[] json = JsonSupport.MAPPER.writeValueAsBytes(body);
        exchange.getResponseHeaders().add("Content-Type", "application/json");
        exchange.getResponseHeaders().add("Access-Control-Allow-Origin", "*");
        exchange.sendResponseHeaders(200, json.length);
        try (OutputStream responseBody = exchange.getResponseBody()) {
            responseBody.write(json);
        }
    }

    private static double round2(double value) {
        return Math.round(value * 100.0) / 100.0;
    }
}
