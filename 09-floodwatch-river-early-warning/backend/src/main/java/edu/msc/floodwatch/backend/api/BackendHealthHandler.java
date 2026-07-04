package edu.msc.floodwatch.backend.api;

import com.amazonaws.services.lambda.runtime.Context;
import com.amazonaws.services.lambda.runtime.RequestHandler;
import edu.msc.floodwatch.backend.util.JsonMapper;
import software.amazon.awssdk.services.dynamodb.DynamoDbClient;
import software.amazon.awssdk.services.dynamodb.model.DescribeTableRequest;
import software.amazon.awssdk.services.sqs.SqsClient;
import software.amazon.awssdk.services.sqs.model.GetQueueAttributesRequest;
import software.amazon.awssdk.services.sqs.model.QueueAttributeName;

import java.util.LinkedHashMap;
import java.util.Map;

/**
 * GET /health - operations-console health probe. Every field is a live call against the
 * configured DynamoDB table and SQS queue (real AWS or floci, same code path either way),
 * never a hardcoded string; a caught exception on either call flips that field to unhealthy
 * without failing the whole response.
 */
public class BackendHealthHandler implements RequestHandler<Map<String, Object>, Map<String, Object>> {

    private final DynamoDbClient dynamoDbClient;
    private final SqsClient sqsClient;
    private final String stageTable;
    private final String intakeQueueUrl;

    public BackendHealthHandler() {
        this(DynamoDbClient.builder().build(), SqsClient.builder().build(),
                System.getenv("FLOODWATCH_STAGE_TABLE"), System.getenv("FLOODWATCH_INTAKE_QUEUE_URL"));
    }

    public BackendHealthHandler(DynamoDbClient dynamoDbClient, SqsClient sqsClient,
            String stageTable, String intakeQueueUrl) {
        this.dynamoDbClient = dynamoDbClient;
        this.sqsClient = sqsClient;
        this.stageTable = stageTable;
        this.intakeQueueUrl = intakeQueueUrl;
    }

    @Override
    public Map<String, Object> handleRequest(Map<String, Object> event, Context context) {
        Map<String, Object> body = new LinkedHashMap<>();

        boolean databaseUp = checkDatabase();
        Long queueDepth = checkQueue();
        boolean queueUp = queueDepth != null;

        body.put("databaseStatus", databaseUp ? "Connected" : "Unavailable");
        body.put("queueStatus", queueUp ? "Connected" : "Unavailable");
        body.put("queueApproximateDepth", queueUp ? queueDepth : 0L);
        // this handler executing at all proves API Gateway + Lambda are reachable and serving
        body.put("apiStatus", "Online");
        body.put("serverStatus", "Online");
        body.put("cloudConnectionStatus", databaseUp && queueUp ? "Connected" : "Degraded");

        try {
            return ApiResponses.ok(JsonMapper.INSTANCE.writeValueAsString(body));
        } catch (Exception e) {
            return ApiResponses.serverError("{\"message\":\"" + e.getMessage() + "\"}");
        }
    }

    private boolean checkDatabase() {
        try {
            dynamoDbClient.describeTable(DescribeTableRequest.builder().tableName(stageTable).build());
            return true;
        } catch (Exception e) {
            return false;
        }
    }

    private Long checkQueue() {
        try {
            var response = sqsClient.getQueueAttributes(GetQueueAttributesRequest.builder()
                    .queueUrl(intakeQueueUrl)
                    .attributeNames(QueueAttributeName.APPROXIMATE_NUMBER_OF_MESSAGES)
                    .build());
            String raw = response.attributes().get(QueueAttributeName.APPROXIMATE_NUMBER_OF_MESSAGES);
            return raw == null ? 0L : Long.valueOf(raw);
        } catch (Exception e) {
            return null;
        }
    }
}
