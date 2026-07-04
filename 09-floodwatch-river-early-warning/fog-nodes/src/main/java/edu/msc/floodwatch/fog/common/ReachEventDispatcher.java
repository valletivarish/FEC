package edu.msc.floodwatch.fog.common;

import com.fasterxml.jackson.databind.ObjectMapper;

import java.io.IOException;
import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.time.Duration;
import java.util.List;
import java.util.Map;
import java.util.concurrent.CopyOnWriteArrayList;

/**
 * Ships fog node events to the backend over HTTP. Failures are queued locally instead of
 * thrown so a slow/unreachable backend never stalls or crashes the fog processing loop.
 */
public class ReachEventDispatcher {

    private final String apiBaseUrl;
    private final HttpClient httpClient;
    private final ObjectMapper objectMapper = new ObjectMapper();
    private final List<Map<String, Object>> fallbackQueue = new CopyOnWriteArrayList<>();

    public ReachEventDispatcher(String apiBaseUrl) {
        this.apiBaseUrl = apiBaseUrl;
        this.httpClient = HttpClient.newBuilder()
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
            // network/backend outage: never let it propagate and take the fog node down with it
            fallbackQueue.add(event);
            return false;
        }
    }

    public List<Map<String, Object>> drainFallback() {
        List<Map<String, Object>> drained = List.copyOf(fallbackQueue);
        fallbackQueue.clear();
        return drained;
    }
}
