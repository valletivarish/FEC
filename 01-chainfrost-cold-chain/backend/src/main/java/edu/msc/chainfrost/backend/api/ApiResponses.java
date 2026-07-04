package edu.msc.chainfrost.backend.api;

import com.amazonaws.services.lambda.runtime.events.APIGatewayProxyRequestEvent;
import com.amazonaws.services.lambda.runtime.events.APIGatewayProxyResponseEvent;

import java.util.Map;

/**
 * Every API Lambda needs the same CORS header and JSON content type, so
 * response building lives here instead of being repeated per handler.
 */
final class ApiResponses {

    private static final Map<String, String> HEADERS = Map.of(
            "Content-Type", "application/json",
            "Access-Control-Allow-Origin", "*"
    );

    private ApiResponses() {
    }

    static APIGatewayProxyResponseEvent ok(String body) {
        return new APIGatewayProxyResponseEvent()
                .withStatusCode(200)
                .withHeaders(HEADERS)
                .withBody(body);
    }

    static APIGatewayProxyResponseEvent notFound(String body) {
        return new APIGatewayProxyResponseEvent()
                .withStatusCode(404)
                .withHeaders(HEADERS)
                .withBody(body);
    }

    static APIGatewayProxyResponseEvent serverError(String body) {
        return new APIGatewayProxyResponseEvent()
                .withStatusCode(500)
                .withHeaders(HEADERS)
                .withBody(body);
    }

    static String pathParam(APIGatewayProxyRequestEvent request, String name) {
        if (request.getPathParameters() == null) {
            return null;
        }
        return request.getPathParameters().get(name);
    }
}
