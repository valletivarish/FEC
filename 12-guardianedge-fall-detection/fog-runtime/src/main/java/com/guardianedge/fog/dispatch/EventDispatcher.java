package com.guardianedge.fog.dispatch;

import com.fasterxml.jackson.databind.ObjectMapper;

import java.io.IOException;
import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.time.Duration;
import java.util.Collections;
import java.util.List;
import java.util.Map;
import java.util.concurrent.CopyOnWriteArrayList;

/** Posts classified fog events to the backend, buffering locally so a transient outage doesn't drop them. */
public class EventDispatcher {

    private final String apiBaseUrl;
    private final HttpClient httpClient;
    private final ObjectMapper objectMapper = new ObjectMapper();
    private final List<Map<String, Object>> fallbackQueue = new CopyOnWriteArrayList<>();

    public EventDispatcher(String apiBaseUrl) {
        this.apiBaseUrl = apiBaseUrl;
        // HTTP/1.1 pinned: the JDK client's default h2c upgrade attempt is mis-routed by the
        // local AWS emulator's edge router (falls through to its S3 handler); real API Gateway
        // negotiates either version fine, so this only affects the local emulator target.
        this.httpClient = HttpClient.newBuilder()
                .version(HttpClient.Version.HTTP_1_1)
                .connectTimeout(Duration.ofSeconds(5))
                .build();
    }

    public boolean dispatch(Map<String, Object> event) {
        try {
            String body = objectMapper.writeValueAsString(event);
            HttpRequest request = HttpRequest.newBuilder()
                    .uri(URI.create(apiBaseUrl + "/events"))
                    .header("Content-Type", "application/json")
                    .POST(HttpRequest.BodyPublishers.ofString(body))
                    .build();
            HttpResponse<String> response = httpClient.send(request, HttpResponse.BodyHandlers.ofString());
            int status = response.statusCode();
            if (status >= 200 && status < 300) {
                return true;
            }
            fallbackQueue.add(event);
            return false;
        } catch (IOException | InterruptedException e) {
            fallbackQueue.add(event);
            return false;
        }
    }

    public List<Map<String, Object>> drainFallback() {
        List<Map<String, Object>> drained = List.copyOf(fallbackQueue);
        fallbackQueue.clear();
        return Collections.unmodifiableList(drained);
    }

    /** Real in-memory buffer depth: events that failed to reach the backend and are awaiting retry. */
    public int queueSize() {
        return fallbackQueue.size();
    }
}
