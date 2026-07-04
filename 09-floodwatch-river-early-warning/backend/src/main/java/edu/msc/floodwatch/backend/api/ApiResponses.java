package edu.msc.floodwatch.backend.api;

import java.util.Map;

/**
 * Builds the plain-Map response shape API Gateway's HTTP API proxy integration expects.
 */
final class ApiResponses {

    private ApiResponses() {
    }

    static Map<String, Object> ok(String body) {
        return Map.of("statusCode", 200, "body", body);
    }

    static Map<String, Object> serverError(String body) {
        return Map.of("statusCode", 500, "body", body);
    }
}
