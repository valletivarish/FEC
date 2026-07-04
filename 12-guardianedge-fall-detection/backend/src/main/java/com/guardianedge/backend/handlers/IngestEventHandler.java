package com.guardianedge.backend.handlers;

import com.amazonaws.services.lambda.runtime.Context;
import com.amazonaws.services.lambda.runtime.RequestHandler;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import software.amazon.awssdk.services.dynamodb.DynamoDbClient;
import software.amazon.awssdk.services.dynamodb.model.AttributeValue;
import software.amazon.awssdk.services.dynamodb.model.PutItemRequest;
import software.amazon.awssdk.services.dynamodb.model.UpdateItemRequest;

import java.time.Instant;
import java.util.HashMap;
import java.util.List;
import java.util.Map;

/** Writes each dispatched fog event to history and rolls it into the resident's live status row. */
public class IngestEventHandler implements RequestHandler<Map<String, Object>, Void> {

    private static final long HISTORY_TTL_SECONDS = 180L * 24 * 60 * 60;

    private final DynamoDbClient dynamoDbClient;
    private final ObjectMapper objectMapper = new ObjectMapper();
    private final String historyTable = System.getenv("GUARDIANEDGE_HISTORY_TABLE");
    private final String statusTable = System.getenv("GUARDIANEDGE_STATUS_TABLE");

    public IngestEventHandler() {
        this.dynamoDbClient = DynamoDbClient.builder().build();
    }

    public IngestEventHandler(DynamoDbClient dynamoDbClient) {
        this.dynamoDbClient = dynamoDbClient;
    }

    @Override
    public Void handleRequest(Map<String, Object> event, Context context) {
        Object recordsRaw = event.get("Records");
        if (!(recordsRaw instanceof List<?> records)) {
            return null;
        }

        for (Object recordObj : records) {
            try {
                processRecord((Map<?, ?>) recordObj);
            } catch (Exception e) {
                // one malformed record must never abort the rest of the batch
                context.getLogger().log("Skipping malformed record: " + e.getMessage());
            }
        }
        return null;
    }

    private void processRecord(Map<?, ?> record) throws Exception {
        Object body = record.get("body");
        JsonNode eventNode = objectMapper.readTree((String) body);

        String residentId = eventNode.path("residentId").asText();
        String type = eventNode.path("type").asText();
        String timestamp = eventNode.path("timestamp").asText();

        writeHistoryItem(residentId, type, timestamp, eventNode);
        upsertResidentStatus(residentId, type, timestamp, eventNode);
    }

    private void writeHistoryItem(String residentId, String type, String timestamp, JsonNode eventNode) {
        Map<String, AttributeValue> item = new HashMap<>();
        item.put("residentId", DynamoAttr.s(residentId));
        item.put("eventTypeTimestamp", DynamoAttr.s(type + "#" + timestamp));
        item.put("type", DynamoAttr.s(type));
        item.put("timestamp", DynamoAttr.s(timestamp));
        item.put("payload", DynamoAttr.s(eventNode.toString()));
        item.put("ttlEpochSeconds", DynamoAttr.n(Instant.now().getEpochSecond() + HISTORY_TTL_SECONDS));

        dynamoDbClient.putItem(PutItemRequest.builder()
                .tableName(historyTable)
                .item(item)
                .build());
    }

    private void upsertResidentStatus(String residentId, String type, String timestamp, JsonNode eventNode) {
        Map<String, String> names = new HashMap<>();
        Map<String, AttributeValue> values = new HashMap<>();
        StringBuilder expression = new StringBuilder("SET #lastUpdated = :lastUpdated, "
                + "#latestEventType = :latestEventType, #latestEventDetail = :latestEventDetail");

        names.put("#lastUpdated", "lastUpdated");
        names.put("#latestEventType", "latestEventType");
        names.put("#latestEventDetail", "latestEventDetail");
        values.put(":lastUpdated", DynamoAttr.s(timestamp));
        values.put(":latestEventType", DynamoAttr.s(type));
        values.put(":latestEventDetail", DynamoAttr.s(eventNode.toString()));

        String riskState = deriveRiskState(type, eventNode);
        if (riskState != null) {
            expression.append(", #currentRiskState = :currentRiskState");
            names.put("#currentRiskState", "currentRiskState");
            values.put(":currentRiskState", DynamoAttr.s(riskState));
        }

        dynamoDbClient.updateItem(UpdateItemRequest.builder()
                .tableName(statusTable)
                .key(Map.of("residentId", DynamoAttr.s(residentId)))
                .updateExpression(expression.toString())
                .expressionAttributeNames(names)
                .expressionAttributeValues(values)
                .build());
    }

    private String deriveRiskState(String type, JsonNode eventNode) {
        return switch (type) {
            case "fall_event" -> "CRITICAL";
            case "vitals_event" -> eventNode.path("newState").asText();
            default -> null;
        };
    }
}
