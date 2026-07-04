package ie.nci.flowforge.fogcommon;

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

/**
 * Posts fog-node insight events to the backend, buffering failed sends so a
 * transient outage does not silently drop data.
 */
public class InsightDispatcher {

    private final String apiBaseUrl;
    private final HttpClient httpClient;
    private final ObjectMapper objectMapper;
    private final List<Map<String, Object>> fallbackQueue = new CopyOnWriteArrayList<>();

    public InsightDispatcher(String apiBaseUrl) {
        this.apiBaseUrl = apiBaseUrl;
        this.httpClient = HttpClient.newBuilder()
                .connectTimeout(Duration.ofSeconds(5))
                .build();
        this.objectMapper = new ObjectMapper();
    }

    public boolean dispatch(Map<String, Object> event) {
        try {
            String body = objectMapper.writeValueAsString(event);
            HttpRequest request = HttpRequest.newBuilder()
                    .uri(URI.create(apiBaseUrl + "/insights"))
                    .header("Content-Type", "application/json")
                    .POST(HttpRequest.BodyPublishers.ofString(body))
                    .build();
            HttpResponse<String> response = httpClient.send(request, HttpResponse.BodyHandlers.ofString());
            boolean ok = response.statusCode() >= 200 && response.statusCode() < 300;
            if (!ok) {
                fallbackQueue.add(event);
            }
            return ok;
        } catch (IOException | InterruptedException e) {
            // network failure must not crash the fog node's read loop
            fallbackQueue.add(event);
            return false;
        }
    }

    public List<Map<String, Object>> drainFallback() {
        List<Map<String, Object>> drained = List.copyOf(fallbackQueue);
        fallbackQueue.clear();
        return drained.isEmpty() ? Collections.emptyList() : drained;
    }

    /** Real in-memory backlog depth at this instant - events buffered because dispatch to the backend failed. */
    public int pendingQueueSize() {
        return fallbackQueue.size();
    }
}
