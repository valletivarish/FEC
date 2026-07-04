package ie.nci.flowforge.backend.handlers;

import com.amazonaws.services.lambda.runtime.Context;
import com.amazonaws.services.lambda.runtime.RequestHandler;
import ie.nci.flowforge.backend.support.DynamoItemConverter;
import ie.nci.flowforge.backend.support.JsonCodec;
import ie.nci.flowforge.backend.support.ProxyResponses;
import software.amazon.awssdk.services.dynamodb.DynamoDbClient;
import software.amazon.awssdk.services.dynamodb.model.AttributeValue;
import software.amazon.awssdk.services.dynamodb.model.QueryRequest;
import software.amazon.awssdk.services.dynamodb.model.QueryResponse;

import java.util.ArrayList;
import java.util.List;
import java.util.Map;

/**
 * GET /pumps/{pumpId}/insights - queries every insight event stored for a pump
 * (partition-key-only query) so the dashboard can render its full recent history.
 */
public class QueryApiHandler implements RequestHandler<Map<String, Object>, Map<String, Object>> {

    private final DynamoDbClient dynamoDbClient;
    private final String insightsTable;

    public QueryApiHandler() {
        this(DynamoDbClient.builder().build());
    }

    public QueryApiHandler(DynamoDbClient dynamoDbClient) {
        this.dynamoDbClient = dynamoDbClient;
        this.insightsTable = System.getenv("FLOWFORGE_INSIGHTS_TABLE");
    }

    @Override
    @SuppressWarnings("unchecked")
    public Map<String, Object> handleRequest(Map<String, Object> event, Context context) {
        Map<String, String> pathParameters = (Map<String, String>) event.get("pathParameters");
        String pumpId = pathParameters == null ? null : pathParameters.get("pumpId");

        try {
            QueryResponse response = dynamoDbClient.query(QueryRequest.builder()
                    .tableName(insightsTable)
                    .keyConditionExpression("pumpId = :pumpId")
                    .expressionAttributeValues(Map.of(":pumpId", AttributeValue.builder().s(pumpId).build()))
                    .build());

            List<Map<String, Object>> insights = new ArrayList<>();
            for (Map<String, AttributeValue> item : response.items()) {
                insights.add(DynamoItemConverter.toJavaMap(item));
            }

            String body = JsonCodec.MAPPER.writeValueAsString(Map.of("pumpId", pumpId, "insights", insights));
            return ProxyResponses.ok(body);
        } catch (Exception e) {
            return ProxyResponses.error(500, "{\"message\":\"" + e.getMessage() + "\"}");
        }
    }
}
