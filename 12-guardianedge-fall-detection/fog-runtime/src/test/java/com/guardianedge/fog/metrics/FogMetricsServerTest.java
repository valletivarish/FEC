package com.guardianedge.fog.metrics;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.guardianedge.fog.dispatch.EventDispatcher;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.Test;

import java.io.IOException;
import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.net.ServerSocket;
import java.util.List;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertTrue;

class FogMetricsServerTest {

    private FogMetricsServer metricsServer;
    private final HttpClient httpClient = HttpClient.newHttpClient();
    private final ObjectMapper objectMapper = new ObjectMapper();

    @AfterEach
    void stopServer() {
        if (metricsServer != null) {
            metricsServer.stop();
        }
    }

    private int freePort() throws IOException {
        try (ServerSocket socket = new ServerSocket(0)) {
            return socket.getLocalPort();
        }
    }

    @Test
    void metricsEndpointReturnsRealCounterAndResourceValues() throws Exception {
        int port = freePort();
        FogNodeMetrics vitalsMetrics = new FogNodeMetrics("VitalsFogNode");
        vitalsMetrics.recordReceived();
        vitalsMetrics.recordReceived();
        vitalsMetrics.recordProcessed();
        vitalsMetrics.recordDispatched(1);

        EventDispatcher dispatcher = new EventDispatcher("http://localhost:1");
        dispatcher.dispatch(java.util.Map.of("type", "vitals_event", "residentId", "resident-01"));

        metricsServer = new FogMetricsServer(port, List.of(vitalsMetrics), new ProcessResourceSampler(), dispatcher);
        metricsServer.start();

        HttpResponse<String> response = httpClient.send(
                HttpRequest.newBuilder(URI.create("http://localhost:" + port + "/metrics")).GET().build(),
                HttpResponse.BodyHandlers.ofString());

        assertEquals(200, response.statusCode());
        JsonNode body = objectMapper.readTree(response.body());
        assertTrue(body.has("cpuUsagePercent"));
        assertTrue(body.has("usedMemoryBytes"));
        assertEquals(1, body.get("queueSize").asInt(), "dispatcher had one failed send buffered");

        JsonNode node = body.get("nodes").get(0);
        assertEquals("VitalsFogNode", node.get("nodeName").asText());
        assertEquals(2, node.get("receivedCount").asLong());
        assertEquals(1, node.get("processedCount").asLong());
        assertEquals(1, node.get("dispatchedCount").asLong());
    }

    @Test
    void healthEndpointReportsUp() throws Exception {
        int port = freePort();
        metricsServer = new FogMetricsServer(port, List.of(), new ProcessResourceSampler(),
                new EventDispatcher("http://localhost:1"));
        metricsServer.start();

        HttpResponse<String> response = httpClient.send(
                HttpRequest.newBuilder(URI.create("http://localhost:" + port + "/health")).GET().build(),
                HttpResponse.BodyHandlers.ofString());

        assertEquals(200, response.statusCode());
        assertTrue(response.body().contains("UP"));
    }
}
