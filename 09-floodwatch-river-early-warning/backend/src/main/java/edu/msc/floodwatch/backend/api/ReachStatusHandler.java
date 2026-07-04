package edu.msc.floodwatch.backend.api;

import com.amazonaws.services.lambda.runtime.Context;
import com.amazonaws.services.lambda.runtime.RequestHandler;
import edu.msc.floodwatch.backend.util.AttributeValues;
import edu.msc.floodwatch.backend.util.JsonMapper;
import software.amazon.awssdk.services.dynamodb.DynamoDbClient;
import software.amazon.awssdk.services.dynamodb.model.AttributeValue;
import software.amazon.awssdk.services.dynamodb.model.QueryRequest;
import software.amazon.awssdk.services.dynamodb.model.QueryResponse;

import java.util.ArrayList;
import java.util.List;
import java.util.Map;

/**
 * GET /reaches/{reachId}/status - queries every stage event stored for the reach
 * (partition key only) so the dashboard can render the most recent state per fog node.
 */
public class ReachStatusHandler implements RequestHandler<Map<String, Object>, Map<String, Object>> {

    private final DynamoDbClient dynamoDbClient;
    private final String stageTable;

    public ReachStatusHandler() {
        this(DynamoDbClient.builder().build(), System.getenv("FLOODWATCH_STAGE_TABLE"));
    }

    public ReachStatusHandler(DynamoDbClient dynamoDbClient, String stageTable) {
        this.dynamoDbClient = dynamoDbClient;
        this.stageTable = stageTable;
    }

    @Override
    @SuppressWarnings("unchecked")
    public Map<String, Object> handleRequest(Map<String, Object> event, Context context) {
        Map<String, String> pathParameters = (Map<String, String>) event.get("pathParameters");
        String reachId = pathParameters == null ? null : pathParameters.get("reachId");

        try {
            QueryResponse response = dynamoDbClient.query(QueryRequest.builder()
                    .tableName(stageTable)
                    .keyConditionExpression("reachId = :reachId")
                    .expressionAttributeValues(Map.of(":reachId", AttributeValue.builder().s(reachId).build()))
                    .build());

            List<Map<String, Object>> items = new ArrayList<>();
            for (Map<String, AttributeValue> item : response.items()) {
                items.add(AttributeValues.toJavaMap(item));
            }

            return ApiResponses.ok(JsonMapper.INSTANCE.writeValueAsString(Map.of("reachId", reachId, "events", items)));
        } catch (Exception e) {
            return ApiResponses.serverError("{\"message\":\"" + e.getMessage() + "\"}");
        }
    }
}
