package binsight.fog.dispatch;

import com.fasterxml.jackson.databind.ObjectMapper;

import java.io.IOException;
import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.time.Duration;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;

/**
 * HTTP fan-out from fog node events to the ingest API. CRITICAL fire-risk alerts get a
 * few retries since a dropped fire alert is worse than a dropped routine reading.
 */
public class BinSightEventDispatcher {

    private static final int DEFAULT_MAX_ATTEMPTS = 3;
    private static final long DEFAULT_BACKOFF_MILLIS = 150;

    private final String apiBaseUrl;
    private final int maxAttemptsForCriticalFireRisk;
    private final long backoffMillis;
    private final HttpClient httpClient;
    private final ObjectMapper objectMapper = new ObjectMapper();
    private final List<Map<String, Object>> fallbackQueue = new ArrayList<>();

    public BinSightEventDispatcher(String apiBaseUrl) {
        this(apiBaseUrl, DEFAULT_MAX_ATTEMPTS, DEFAULT_BACKOFF_MILLIS);
    }

    public BinSightEventDispatcher(String apiBaseUrl, int maxAttempts, long backoffMillis) {
        this.apiBaseUrl = apiBaseUrl;
        this.maxAttemptsForCriticalFireRisk = maxAttempts;
        this.backoffMillis = backoffMillis;
        this.httpClient = HttpClient.newBuilder()
                .connectTimeout(Duration.ofSeconds(5))
                .build();
    }

    public boolean dispatch(Map<String, Object> event) {
        String path = resolvePath(event);
        if (path == null) {
            return false;
        }

        boolean isCriticalFireRisk = "fire_risk_alert".equals(event.get("type"))
                && "CRITICAL".equals(event.get("riskStatus"));
        int attempts = isCriticalFireRisk ? maxAttemptsForCriticalFireRisk : 1;

        boolean success = false;
        for (int attempt = 1; attempt <= attempts && !success; attempt++) {
            success = attemptPost(apiBaseUrl + path, event);
            if (!success && attempt < attempts) {
                sleepBackoff();
            }
        }

        if (!success) {
            fallbackQueue.add(event);
        }
        return success;
    }

    public List<Map<String, Object>> drainFallback() {
        List<Map<String, Object>> drained = new ArrayList<>(fallbackQueue);
        fallbackQueue.clear();
        return drained;
    }

    protected boolean attemptPost(String url, Map<String, Object> event) {
        try {
            String json = objectMapper.writeValueAsString(event);
            HttpRequest request = HttpRequest.newBuilder()
                    .uri(URI.create(url))
                    .header("Content-Type", "application/json")
                    .POST(HttpRequest.BodyPublishers.ofString(json))
                    .build();
            HttpResponse<String> response = httpClient.send(request, HttpResponse.BodyHandlers.ofString());
            return response.statusCode() >= 200 && response.statusCode() < 300;
        } catch (IOException | InterruptedException e) {
            return false;
        }
    }

    private void sleepBackoff() {
        try {
            Thread.sleep(backoffMillis);
        } catch (InterruptedException e) {
            Thread.currentThread().interrupt();
        }
    }

    private String resolvePath(Map<String, Object> event) {
        Object type = event.get("type");
        if ("cluster_verdict".equals(type)) {
            return "/cluster-verdicts";
        }
        if ("fire_risk_alert".equals(type)) {
            return "/fire-risk";
        }
        if ("work_list_event".equals(type)) {
            return "/work-list";
        }
        return null;
    }
}
