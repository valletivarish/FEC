package edu.msc.floodwatch.backend.api;

import com.amazonaws.services.lambda.runtime.Context;
import com.amazonaws.services.lambda.runtime.RequestHandler;
import edu.msc.floodwatch.backend.util.JsonMapper;
import software.amazon.awssdk.services.dynamodb.DynamoDbClient;
import software.amazon.awssdk.services.dynamodb.model.ScanRequest;
import software.amazon.awssdk.services.dynamodb.model.Select;

import java.util.LinkedHashMap;
import java.util.Map;

/**
 * GET /metrics - a real persisted-record count straight off the stage table (Select.COUNT
 * scan, no item bodies pulled back). Every event this project ever stores is one PutItem
 * from ReachIntakeHandler, so this count doubles as both "messages received" and "messages
 * stored" for the backend side of the operations console - there is no separate received-
 * but-dropped path in this architecture, so the two are genuinely the same number.
 */
public class BackendMetricsHandler implements RequestHandler<Map<String, Object>, Map<String, Object>> {

    private final DynamoDbClient dynamoDbClient;
    private final String stageTable;

    public BackendMetricsHandler() {
        this(DynamoDbClient.builder().build(), System.getenv("FLOODWATCH_STAGE_TABLE"));
    }

    public BackendMetricsHandler(DynamoDbClient dynamoDbClient, String stageTable) {
        this.dynamoDbClient = dynamoDbClient;
        this.stageTable = stageTable;
    }

    @Override
    public Map<String, Object> handleRequest(Map<String, Object> event, Context context) {
        try {
            int storedCount = countStoredItems();
            Map<String, Object> body = new LinkedHashMap<>();
            body.put("messagesReceived", storedCount);
            body.put("messagesStored", storedCount);
            return ApiResponses.ok(JsonMapper.INSTANCE.writeValueAsString(body));
        } catch (Exception e) {
            return ApiResponses.serverError("{\"message\":\"" + e.getMessage() + "\"}");
        }
    }

    private int countStoredItems() {
        int total = 0;
        Map<String, software.amazon.awssdk.services.dynamodb.model.AttributeValue> lastEvaluatedKey = null;
        do {
            ScanRequest.Builder requestBuilder = ScanRequest.builder()
                    .tableName(stageTable)
                    .select(Select.COUNT);
            if (lastEvaluatedKey != null) {
                requestBuilder.exclusiveStartKey(lastEvaluatedKey);
            }
            var response = dynamoDbClient.scan(requestBuilder.build());
            total += response.count();
            lastEvaluatedKey = response.lastEvaluatedKey().isEmpty() ? null : response.lastEvaluatedKey();
        } while (lastEvaluatedKey != null);
        return total;
    }
}
