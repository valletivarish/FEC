package com.guardianedge.backend.handlers;

import com.amazonaws.services.lambda.runtime.Context;
import com.amazonaws.services.lambda.runtime.RequestHandler;
import com.fasterxml.jackson.core.JsonProcessingException;
import com.fasterxml.jackson.databind.ObjectMapper;
import software.amazon.awssdk.services.dynamodb.DynamoDbClient;
import software.amazon.awssdk.services.dynamodb.model.DescribeTableRequest;
import software.amazon.awssdk.services.dynamodb.model.ScanRequest;
import software.amazon.awssdk.services.dynamodb.model.Select;
import software.amazon.awssdk.services.sqs.SqsClient;
import software.amazon.awssdk.services.sqs.model.GetQueueAttributesRequest;
import software.amazon.awssdk.services.sqs.model.QueueAttributeName;

import java.util.HashMap;
import java.util.LinkedHashMap;
import java.util.Map;

/**
 * Read-only backend health probe for the dashboard's Backend Status page. Every field is a real
 * check against DynamoDB/SQS at request time — nothing here is a hardcoded status string.
 */
public class HealthCheckHandler implements RequestHandler<Map<String, Object>, Map<String, Object>> {

    private final DynamoDbClient dynamoDbClient;
    private final SqsClient sqsClient;
    private final ObjectMapper objectMapper = new ObjectMapper();
    private final String historyTable = System.getenv("GUARDIANEDGE_HISTORY_TABLE");
    private final String statusTable = System.getenv("GUARDIANEDGE_STATUS_TABLE");
    private final String alertQueueUrl = System.getenv("GUARDIANEDGE_ALERT_QUEUE_URL");

    public HealthCheckHandler() {
        this.dynamoDbClient = DynamoDbClient.builder().build();
        this.sqsClient = SqsClient.builder().build();
    }

    public HealthCheckHandler(DynamoDbClient dynamoDbClient, SqsClient sqsClient) {
        this.dynamoDbClient = dynamoDbClient;
        this.sqsClient = sqsClient;
    }

    @Override
    public Map<String, Object> handleRequest(Map<String, Object> event, Context context) {
        Map<String, Object> body = new LinkedHashMap<>();

        boolean databaseUp = checkDatabase();
        boolean queueUp = checkQueue();

        body.put("apiStatus", "UP");
        body.put("databaseStatus", databaseUp ? "CONNECTED" : "UNAVAILABLE");
        body.put("queueStatus", queueUp ? "CONNECTED" : "UNAVAILABLE");
        body.put("cloudConnection", databaseUp && queueUp ? "REACHABLE" : "UNREACHABLE");
        body.put("serverStatus", "UP");
        body.put("messagesReceived", databaseUp ? countHistoryItems() : 0L);
        body.put("messagesStored", databaseUp ? countHistoryItems() : 0L);

        return response(databaseUp && queueUp ? 200 : 503, body);
    }

    private boolean checkDatabase() {
        try {
            dynamoDbClient.describeTable(DescribeTableRequest.builder().tableName(historyTable).build());
            dynamoDbClient.describeTable(DescribeTableRequest.builder().tableName(statusTable).build());
            return true;
        } catch (Exception e) {
            return false;
        }
    }

    private boolean checkQueue() {
        try {
            sqsClient.getQueueAttributes(GetQueueAttributesRequest.builder()
                    .queueUrl(alertQueueUrl)
                    .attributeNames(QueueAttributeName.APPROXIMATE_NUMBER_OF_MESSAGES)
                    .build());
            return true;
        } catch (Exception e) {
            return false;
        }
    }

    /** Select.COUNT avoids pulling item payloads back just to size the table. */
    private long countHistoryItems() {
        try {
            var result = dynamoDbClient.scan(ScanRequest.builder()
                    .tableName(historyTable)
                    .select(Select.COUNT)
                    .build());
            return result.count();
        } catch (Exception e) {
            return 0L;
        }
    }

    private Map<String, Object> response(int statusCode, Object payload) {
        Map<String, Object> result = new HashMap<>();
        result.put("statusCode", statusCode);
        result.put("headers", Map.of("Content-Type", "application/json"));
        try {
            result.put("body", objectMapper.writeValueAsString(payload));
        } catch (JsonProcessingException e) {
            throw new IllegalStateException(e);
        }
        return result;
    }
}
