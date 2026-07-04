package ie.nci.flowforge.backend.support;

import java.util.Map;

/** Builds API-Gateway-HTTP-API proxy-integration-shaped Lambda return maps. */
public final class ProxyResponses {

    private ProxyResponses() {
    }

    public static Map<String, Object> ok(String jsonBody) {
        return Map.of("statusCode", 200, "body", jsonBody);
    }

    public static Map<String, Object> accepted(String jsonBody) {
        return Map.of("statusCode", 202, "body", jsonBody);
    }

    public static Map<String, Object> error(int statusCode, String jsonBody) {
        return Map.of("statusCode", statusCode, "body", jsonBody);
    }
}
