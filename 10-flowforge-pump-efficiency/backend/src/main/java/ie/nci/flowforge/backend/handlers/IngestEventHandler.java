package ie.nci.flowforge.backend.handlers;

import com.amazonaws.services.lambda.runtime.Context;
import com.amazonaws.services.lambda.runtime.LambdaLogger;
import com.amazonaws.services.lambda.runtime.RequestHandler;
import ie.nci.flowforge.backend.support.DynamoItemConverter;
import ie.nci.flowforge.backend.support.JsonCodec;
import software.amazon.awssdk.services.dynamodb.DynamoDbClient;
import software.amazon.awssdk.services.dynamodb.model.AttributeValue;
import software.amazon.awssdk.services.dynamodb.model.PutItemRequest;

import java.util.List;
import java.util.Map;

/**
 * SQS-triggered: each record body is one fog-node insight event (health_event,
 * hydraulics_event or integrity_event). Stored under a composite sort key so a
 * pump's history is queryable in event-type/time order via QueryApiHandler.
 */
public class IngestEventHandler implements RequestHandler<Map<String, Object>, Void> {

    private final DynamoDbClient dynamoDbClient;
    private final String insightsTable;

    public IngestEventHandler() {
        this(DynamoDbClient.builder().build());
    }

    public IngestEventHandler(DynamoDbClient dynamoDbClient) {
        this.dynamoDbClient = dynamoDbClient;
        this.insightsTable = System.getenv("FLOWFORGE_INSIGHTS_TABLE");
    }

    @Override
    @SuppressWarnings("unchecked")
    public Void handleRequest(Map<String, Object> event, Context context) {
        LambdaLogger logger = context.getLogger();
        List<Map<String, Object>> records = (List<Map<String, Object>>) event.getOrDefault("Records", List.of());

        for (Map<String, Object> record : records) {
            try {
                String body = String.valueOf(record.get("body"));
                Map<String, Object> insightEvent = JsonCodec.MAPPER.readValue(body, Map.class);
                putInsightEvent(insightEvent);
            } catch (Exception e) {
                // one bad record must not sink the rest of the SQS batch
                logger.log("Skipping malformed insight record: " + e.getMessage());
            }
        }
        return null;
    }

    private void putInsightEvent(Map<String, Object> insightEvent) {
        String type = String.valueOf(insightEvent.get("type"));
        String timestamp = String.valueOf(insightEvent.get("timestamp"));

        Map<String, AttributeValue> item = DynamoItemConverter.toAttributeMap(insightEvent);
        item.put("eventTypeTimestamp", AttributeValue.builder().s(type + "#" + timestamp).build());

        dynamoDbClient.putItem(PutItemRequest.builder()
                .tableName(insightsTable)
                .item(item)
                .build());
    }
}
