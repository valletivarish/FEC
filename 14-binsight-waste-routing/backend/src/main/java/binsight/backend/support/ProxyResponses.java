package binsight.backend.support;

import java.util.Map;

/** Builds API-Gateway-HTTP-API proxy-integration-shaped Lambda return maps. */
public final class ProxyResponses {

    private ProxyResponses() {
    }

    public static Map<String, Object> ok(String jsonBody) {
        return response(200, jsonBody);
    }

    public static Map<String, Object> accepted(String jsonBody) {
        return response(202, jsonBody);
    }

    public static Map<String, Object> error(int statusCode, String jsonBody) {
        return response(statusCode, jsonBody);
    }

    private static Map<String, Object> response(int statusCode, String jsonBody) {
        return Map.of(
                "statusCode", statusCode,
                "headers", Map.of("Content-Type", "application/json"),
                "body", jsonBody);
    }
}
