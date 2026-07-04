package com.guardianedge.backend.handlers;

import com.amazonaws.services.lambda.runtime.Context;
import com.amazonaws.services.lambda.runtime.RequestHandler;
import software.amazon.awssdk.services.dynamodb.DynamoDbClient;
import software.amazon.awssdk.services.dynamodb.model.AttributeValue;
import software.amazon.awssdk.services.dynamodb.model.UpdateItemRequest;

import java.util.List;
import java.util.Map;

/** Reacts to EventHistoryTable inserts and rolls up active-critical-alert state per resident. */
public class AlertProcessorHandler implements RequestHandler<Map<String, Object>, Void> {

    private final DynamoDbClient dynamoDbClient;
    private final String statusTable = System.getenv("GUARDIANEDGE_STATUS_TABLE");

    public AlertProcessorHandler() {
        this.dynamoDbClient = DynamoDbClient.builder().build();
    }

    public AlertProcessorHandler(DynamoDbClient dynamoDbClient) {
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
                context.getLogger().log("Skipping malformed stream record: " + e.getMessage());
            }
        }
        return null;
    }

    @SuppressWarnings("unchecked")
    private void processRecord(Map<?, ?> record) {
        if (!"INSERT".equals(record.get("eventName"))) {
            return;
        }

        Map<String, Object> dynamodb = (Map<String, Object>) record.get("dynamodb");
        if (dynamodb == null) {
            return;
        }
        Map<String, Object> newImage = (Map<String, Object>) dynamodb.get("NewImage");
        if (newImage == null) {
            return;
        }

        String type = attrString(newImage.get("type"));
        if (!isCriticalWorthy(type, newImage)) {
            return;
        }

        String residentId = attrString(newImage.get("residentId"));
        if (residentId == null) {
            return;
        }

        incrementCriticalAlert(residentId);
    }

    private boolean isCriticalWorthy(String type, Map<String, Object> newImage) {
        if ("fall_event".equals(type) || "inactivity_alert".equals(type)) {
            return true;
        }
        if ("vitals_event".equals(type)) {
            return "CRITICAL".equals(attrString(newImage.get("newState")));
        }
        return false;
    }

    @SuppressWarnings("unchecked")
    private String attrString(Object dynamoJsonAttr) {
        if (!(dynamoJsonAttr instanceof Map<?, ?> attr)) {
            return null;
        }
        Object s = ((Map<String, Object>) attr).get("S");
        return s == null ? null : s.toString();
    }

    private void incrementCriticalAlert(String residentId) {
        Map<String, String> names = Map.of(
                "#activeCriticalAlertCount", "activeCriticalAlertCount",
                "#needsAcknowledgement", "needsAcknowledgement"
        );
        Map<String, AttributeValue> values = Map.of(
                ":increment", DynamoAttr.n(1L),
                ":true", AttributeValue.builder().bool(true).build()
        );

        dynamoDbClient.updateItem(UpdateItemRequest.builder()
                .tableName(statusTable)
                .key(Map.of("residentId", DynamoAttr.s(residentId)))
                .updateExpression("ADD #activeCriticalAlertCount :increment "
                        + "SET #needsAcknowledgement = :true")
                .expressionAttributeNames(names)
                .expressionAttributeValues(values)
                .build());
    }
}
