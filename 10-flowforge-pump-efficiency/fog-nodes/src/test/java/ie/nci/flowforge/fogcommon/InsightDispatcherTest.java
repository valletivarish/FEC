package ie.nci.flowforge.fogcommon;

import com.sun.net.httpserver.HttpServer;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.Test;

import java.io.IOException;
import java.net.InetSocketAddress;
import java.net.ServerSocket;
import java.util.HashMap;
import java.util.List;
import java.util.Map;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertTrue;

class InsightDispatcherTest {

    private HttpServer server;

    @AfterEach
    void tearDown() {
        if (server != null) {
            server.stop(0);
        }
    }

    private int freePort() throws IOException {
        try (ServerSocket socket = new ServerSocket(0)) {
            return socket.getLocalPort();
        }
    }

    @Test
    void dispatchReturnsTrueAndPostsJsonOn2xx() throws IOException {
        int port = freePort();
        server = HttpServer.create(new InetSocketAddress("localhost", port), 0);
        server.createContext("/insights", exchange -> {
            byte[] response = "ok".getBytes();
            exchange.sendResponseHeaders(200, response.length);
            exchange.getResponseBody().write(response);
            exchange.close();
        });
        server.start();

        InsightDispatcher dispatcher = new InsightDispatcher("http://localhost:" + port);
        Map<String, Object> event = new HashMap<>();
        event.put("type", "health_event");
        event.put("pumpId", "pump-01");

        boolean result = dispatcher.dispatch(event);

        assertTrue(result);
        assertTrue(dispatcher.drainFallback().isEmpty());
    }

    @Test
    void dispatchReturnsFalseAndQueuesFallbackOnNon2xx() throws IOException {
        int port = freePort();
        server = HttpServer.create(new InetSocketAddress("localhost", port), 0);
        server.createContext("/insights", exchange -> {
            byte[] response = "error".getBytes();
            exchange.sendResponseHeaders(500, response.length);
            exchange.getResponseBody().write(response);
            exchange.close();
        });
        server.start();

        InsightDispatcher dispatcher = new InsightDispatcher("http://localhost:" + port);
        Map<String, Object> event = new HashMap<>();
        event.put("type", "integrity_event");
        event.put("pumpId", "pump-02");

        boolean result = dispatcher.dispatch(event);

        assertFalse(result);
        List<Map<String, Object>> fallback = dispatcher.drainFallback();
        assertEquals(1, fallback.size());
        assertEquals("pump-02", fallback.get(0).get("pumpId"));
    }

    @Test
    void dispatchReturnsFalseAndQueuesFallbackOnConnectionFailure() {
        // nothing listening on this port; the client must catch IOException, not propagate it
        InsightDispatcher dispatcher = new InsightDispatcher("http://localhost:1");
        Map<String, Object> event = new HashMap<>();
        event.put("type", "hydraulics_event");
        event.put("pumpId", "pump-03");

        boolean result = dispatcher.dispatch(event);

        assertFalse(result);
        assertEquals(1, dispatcher.drainFallback().size());
    }

    @Test
    void drainFallbackClearsQueueAfterRead() {
        InsightDispatcher dispatcher = new InsightDispatcher("http://localhost:1");
        Map<String, Object> event = new HashMap<>();
        event.put("type", "health_event");
        dispatcher.dispatch(event);

        List<Map<String, Object>> firstDrain = dispatcher.drainFallback();
        List<Map<String, Object>> secondDrain = dispatcher.drainFallback();

        assertEquals(1, firstDrain.size());
        assertTrue(secondDrain.isEmpty());
    }

    @Test
    void classIsSubclassable() {
        FakeInsightDispatcher fake = new FakeInsightDispatcher();
        Map<String, Object> event = new HashMap<>();
        event.put("type", "health_event");

        boolean result = fake.dispatch(event);

        assertTrue(result);
        assertEquals(1, fake.getDispatched().size());
    }
}
