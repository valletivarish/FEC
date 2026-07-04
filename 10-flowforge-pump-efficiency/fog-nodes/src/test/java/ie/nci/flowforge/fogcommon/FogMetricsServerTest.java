package ie.nci.flowforge.fogcommon;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
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

    private FogMetricsServer server;

    @AfterEach
    void tearDown() {
        if (server != null) {
            server.stop();
        }
    }

    private int freePort() throws IOException {
        try (ServerSocket socket = new ServerSocket(0)) {
            return socket.getLocalPort();
        }
    }

    @Test
    void metricsEndpointReturnsRealCountersForEveryConfiguredNode() throws Exception {
        int port = freePort();
        FogNodeMetrics healthMetrics = new FogNodeMetrics("HealthNode");
        healthMetrics.recordReceived();
        healthMetrics.recordProcessed(java.time.Instant.now().toString());
        healthMetrics.recordDispatched(1);
        FogNodeMetrics hydraulicsMetrics = new FogNodeMetrics("HydraulicsNode");
        InsightDispatcher dispatcher = new InsightDispatcher("http://localhost:1");
        dispatcher.dispatch(java.util.Map.of("type", "health_event"));

        server = new FogMetricsServer(port, List.of(healthMetrics, hydraulicsMetrics), dispatcher);
        server.start();

        HttpClient client = HttpClient.newHttpClient();
        HttpResponse<String> response = client.send(
                HttpRequest.newBuilder().uri(URI.create("http://localhost:" + port + "/metrics")).GET().build(),
                HttpResponse.BodyHandlers.ofString());

        assertEquals(200, response.statusCode());

        JsonNode body = new ObjectMapper().readTree(response.body());
        assertTrue(body.has("cpuUsagePercent"));
        assertTrue(body.has("usedHeapBytes"));
        assertEquals(1, body.get("queueSize").asInt(), "the failed dispatch above must show up as real queue backlog");

        JsonNode nodes = body.get("nodes");
        assertEquals(2, nodes.size());
        assertEquals("HealthNode", nodes.get(0).get("nodeName").asText());
        assertEquals(1, nodes.get(0).get("receivedCount").asLong());
        assertEquals(1, nodes.get(0).get("processedCount").asLong());
        assertEquals(1, nodes.get(0).get("dispatchedCount").asLong());
        assertEquals("Running", nodes.get(0).get("status").asText());
        assertEquals("Idle", nodes.get(1).get("status").asText(), "a node with zero activity must report Idle, not Running");
    }

    @Test
    void getPortReturnsTheBoundPort() throws Exception {
        int port = freePort();
        server = new FogMetricsServer(port, List.of(), new InsightDispatcher("http://localhost:1"));
        server.start();

        assertEquals(port, server.getPort());
    }
}
