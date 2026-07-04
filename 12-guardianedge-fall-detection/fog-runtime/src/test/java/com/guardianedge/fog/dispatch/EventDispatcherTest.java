package com.guardianedge.fog.dispatch;

import com.sun.net.httpserver.HttpServer;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.Test;

import java.io.IOException;
import java.net.InetSocketAddress;
import java.util.List;
import java.util.Map;
import java.util.concurrent.atomic.AtomicInteger;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertTrue;

class EventDispatcherTest {

    private HttpServer server;

    @AfterEach
    void stopServer() {
        if (server != null) {
            server.stop(0);
        }
    }

    @Test
    void dispatchReturnsTrueOn2xxAndPostsJsonBody() throws IOException {
        AtomicInteger receivedRequests = new AtomicInteger(0);
        server = HttpServer.create(new InetSocketAddress("localhost", 0), 0);
        server.createContext("/events", exchange -> {
            receivedRequests.incrementAndGet();
            byte[] response = "ok".getBytes();
            exchange.sendResponseHeaders(200, response.length);
            exchange.getResponseBody().write(response);
            exchange.close();
        });
        server.start();

        EventDispatcher dispatcher = new EventDispatcher("http://localhost:" + server.getAddress().getPort());
        boolean result = dispatcher.dispatch(Map.of("type", "fall_event", "residentId", "resident-01"));

        assertTrue(result);
        assertEquals(1, receivedRequests.get());
        assertTrue(dispatcher.drainFallback().isEmpty());
    }

    @Test
    void dispatchReturnsFalseAndBuffersFallbackOnNon2xx() throws IOException {
        server = HttpServer.create(new InetSocketAddress("localhost", 0), 0);
        server.createContext("/events", exchange -> {
            exchange.sendResponseHeaders(500, -1);
            exchange.close();
        });
        server.start();

        EventDispatcher dispatcher = new EventDispatcher("http://localhost:" + server.getAddress().getPort());
        Map<String, Object> event = Map.of("type", "vitals_event", "residentId", "resident-02");
        boolean result = dispatcher.dispatch(event);

        assertFalse(result);
        List<Map<String, Object>> fallback = dispatcher.drainFallback();
        assertEquals(1, fallback.size());
        assertEquals("resident-02", fallback.get(0).get("residentId"));
    }

    @Test
    void dispatchReturnsFalseAndBuffersFallbackOnConnectionFailure() {
        EventDispatcher dispatcher = new EventDispatcher("http://localhost:1");
        boolean result = dispatcher.dispatch(Map.of("type", "presence_event", "residentId", "resident-03"));

        assertFalse(result);
        assertEquals(1, dispatcher.drainFallback().size());
    }

    @Test
    void drainFallbackClearsTheQueue() {
        EventDispatcher dispatcher = new EventDispatcher("http://localhost:1");
        dispatcher.dispatch(Map.of("type", "comfort_event", "residentId", "resident-01"));

        assertEquals(1, dispatcher.drainFallback().size());
        assertTrue(dispatcher.drainFallback().isEmpty());
    }

    @Test
    void isSubclassableForTestFakes() {
        List<Map<String, Object>> captured = new java.util.ArrayList<>();
        EventDispatcher fake = new EventDispatcher("http://unused") {
            @Override
            public boolean dispatch(Map<String, Object> event) {
                captured.add(event);
                return true;
            }
        };

        boolean result = fake.dispatch(Map.of("type", "inactivity_alert", "residentId", "resident-01"));
        assertTrue(result);
        assertEquals(1, captured.size());
    }
}
