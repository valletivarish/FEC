package com.guardianedge.backend.handlers;

import com.amazonaws.services.lambda.runtime.Context;
import com.amazonaws.services.lambda.runtime.RequestHandler;
import com.fasterxml.jackson.core.JsonProcessingException;
import com.fasterxml.jackson.databind.ObjectMapper;
import software.amazon.awssdk.services.dynamodb.DynamoDbClient;
import software.amazon.awssdk.services.dynamodb.model.AttributeValue;
import software.amazon.awssdk.services.dynamodb.model.QueryRequest;
import software.amazon.awssdk.services.dynamodb.model.ReturnValue;
import software.amazon.awssdk.services.dynamodb.model.ScanRequest;
import software.amazon.awssdk.services.dynamodb.model.UpdateItemRequest;

import java.util.ArrayList;
import java.util.Comparator;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.TreeMap;

/** Read API for the dashboard: roster, per-resident history, and carer acknowledgement. */
public class QueryResidentsHandler implements RequestHandler<Map<String, Object>, Map<String, Object>> {

    private final DynamoDbClient dynamoDbClient;
    private final ObjectMapper objectMapper = new ObjectMapper();
    private final String statusTable = System.getenv("GUARDIANEDGE_STATUS_TABLE");
    private final String historyTable = System.getenv("GUARDIANEDGE_HISTORY_TABLE");

    public QueryResidentsHandler() {
        this.dynamoDbClient = DynamoDbClient.builder().build();
    }

    public QueryResidentsHandler(DynamoDbClient dynamoDbClient) {
        this.dynamoDbClient = dynamoDbClient;
    }

    @Override
    @SuppressWarnings("unchecked")
    public Map<String, Object> handleRequest(Map<String, Object> event, Context context) {
        String routeKey = (String) event.get("routeKey");

        try {
            if ("GET /residents".equals(routeKey)) {
                return listResidents();
            }
            if ("GET /residents/{residentId}/history".equals(routeKey)) {
                String residentId = pathParam(event, "residentId");
                return residentHistory(residentId);
            }
            if ("POST /residents/{residentId}/acknowledge".equals(routeKey)) {
                String residentId = pathParam(event, "residentId");
                return acknowledge(residentId);
            }
            // Fallback for a Lambda Function URL invocation, which always reports routeKey as
            // the literal "$default" (no route pattern) instead of synthesizing the API Gateway
            // v2 "METHOD /path" form above - only reached when the primary routeKey match misses.
            return routeFromRequestContext(event);
        } catch (Exception e) {
            context.getLogger().log("QueryResidentsHandler error: " + e.getMessage());
            return response(500, Map.of("message", "Internal error"));
        }
    }

    @SuppressWarnings("unchecked")
    private Map<String, Object> routeFromRequestContext(Map<String, Object> event) {
        Object requestContext = event.get("requestContext");
        if (!(requestContext instanceof Map<?, ?> rc)) {
            return response(404, Map.of("message", "Not found"));
        }
        Object httpCtx = ((Map<String, Object>) rc).get("http");
        if (!(httpCtx instanceof Map<?, ?> http)) {
            return response(404, Map.of("message", "Not found"));
        }
        String method = String.valueOf(((Map<String, Object>) http).get("method"));
        String path = String.valueOf(((Map<String, Object>) http).get("path"));

        if ("GET".equals(method) && "/residents".equals(path)) {
            return listResidents();
        }
        var historyMatch = java.util.regex.Pattern.compile("^/residents/([^/]+)/history$").matcher(path);
        if ("GET".equals(method) && historyMatch.matches()) {
            return residentHistory(historyMatch.group(1));
        }
        var ackMatch = java.util.regex.Pattern.compile("^/residents/([^/]+)/acknowledge$").matcher(path);
        if ("POST".equals(method) && ackMatch.matches()) {
            return acknowledge(ackMatch.group(1));
        }
        return response(404, Map.of("message", "Not found"));
    }

    @SuppressWarnings("unchecked")
    private String pathParam(Map<String, Object> event, String name) {
        Object pathParameters = event.get("pathParameters");
        if (!(pathParameters instanceof Map<?, ?> params)) {
            return null;
        }
        Object value = ((Map<String, Object>) params).get(name);
        return value == null ? null : value.toString();
    }

    private Map<String, Object> listResidents() {
        var result = dynamoDbClient.scan(ScanRequest.builder()
                .tableName(statusTable)
                .build());

        List<Map<String, Object>> residents = new ArrayList<>();
        for (Map<String, AttributeValue> item : result.items()) {
            residents.add(toPlainMap(item));
        }
        return response(200, residents);
    }

    private Map<String, Object> residentHistory(String residentId) {
        if (residentId == null) {
            return response(404, Map.of("message", "Not found"));
        }

        var result = dynamoDbClient.query(QueryRequest.builder()
                .tableName(historyTable)
                .keyConditionExpression("residentId = :residentId")
                .expressionAttributeValues(Map.of(":residentId", DynamoAttr.s(residentId)))
                .build());

        List<Map<String, Object>> items = new ArrayList<>();
        for (Map<String, AttributeValue> item : result.items()) {
            items.add(toPlainMap(item));
        }
        items.sort(Comparator.comparing(
                (Map<String, Object> m) -> String.valueOf(m.get("eventTypeTimestamp"))
        ).reversed());

        return response(200, items);
    }

    private Map<String, Object> acknowledge(String residentId) {
        if (residentId == null) {
            return response(404, Map.of("message", "Not found"));
        }

        Map<String, String> names = Map.of(
                "#needsAcknowledgement", "needsAcknowledgement",
                "#activeCriticalAlertCount", "activeCriticalAlertCount"
        );
        Map<String, AttributeValue> values = Map.of(
                ":false", AttributeValue.builder().bool(false).build(),
                ":zero", DynamoAttr.n(0L)
        );

        var result = dynamoDbClient.updateItem(UpdateItemRequest.builder()
                .tableName(statusTable)
                .key(Map.of("residentId", DynamoAttr.s(residentId)))
                .updateExpression("SET #needsAcknowledgement = :false, #activeCriticalAlertCount = :zero")
                .expressionAttributeNames(names)
                .expressionAttributeValues(values)
                .returnValues(ReturnValue.ALL_NEW)
                .build());

        return response(200, toPlainMap(result.attributes()));
    }

    private Map<String, Object> toPlainMap(Map<String, AttributeValue> item) {
        Map<String, Object> plain = new TreeMap<>();
        for (Map.Entry<String, AttributeValue> entry : item.entrySet()) {
            plain.put(entry.getKey(), plainValue(entry.getValue()));
        }
        return plain;
    }

    private Object plainValue(AttributeValue value) {
        if (value.s() != null) {
            return value.s();
        }
        if (value.n() != null) {
            return value.n();
        }
        if (value.bool() != null) {
            return value.bool();
        }
        return null;
    }

    private Map<String, Object> response(int statusCode, Object body) {
        Map<String, Object> result = new HashMap<>();
        result.put("statusCode", statusCode);
        result.put("headers", Map.of("Content-Type", "application/json"));
        try {
            result.put("body", objectMapper.writeValueAsString(body));
        } catch (JsonProcessingException e) {
            // body is always a plain Map/List we construct; serialization cannot realistically fail
            throw new IllegalStateException(e);
        }
        return result;
    }
}
