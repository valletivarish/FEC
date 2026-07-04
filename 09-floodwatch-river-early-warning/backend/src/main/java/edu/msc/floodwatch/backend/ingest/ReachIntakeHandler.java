package edu.msc.floodwatch.backend.ingest;

import com.amazonaws.services.lambda.runtime.Context;
import com.amazonaws.services.lambda.runtime.LambdaLogger;
import com.amazonaws.services.lambda.runtime.RequestHandler;
import edu.msc.floodwatch.backend.util.AttributeValues;
import edu.msc.floodwatch.backend.util.JsonMapper;
import software.amazon.awssdk.services.dynamodb.DynamoDbClient;
import software.amazon.awssdk.services.dynamodb.model.AttributeValue;
import software.amazon.awssdk.services.dynamodb.model.PutItemRequest;

import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

/**
 * SQS-triggered entrypoint: each record body is one fog-node event (hydro_event,
 * quality_event, or meteo_event) queued by ReachEventDispatcher. Stored as-is under
 * a composite sort key so a reach's history is queryable in event-type order.
 */
public class ReachIntakeHandler implements RequestHandler<Map<String, Object>, Void> {

    private final DynamoDbClient dynamoDbClient;
    private final String stageTable;

    public ReachIntakeHandler() {
        this(DynamoDbClient.builder().build(), System.getenv("FLOODWATCH_STAGE_TABLE"));
    }

    public ReachIntakeHandler(DynamoDbClient dynamoDbClient, String stageTable) {
        this.dynamoDbClient = dynamoDbClient;
        this.stageTable = stageTable;
    }

    @Override
    @SuppressWarnings("unchecked")
    public Void handleRequest(Map<String, Object> event, Context context) {
        LambdaLogger logger = context.getLogger();
        List<Map<String, Object>> records = (List<Map<String, Object>>) event.getOrDefault("Records", List.of());

        for (Map<String, Object> record : records) {
            try {
                String body = String.valueOf(record.get("body"));
                Map<String, Object> reachEvent = JsonMapper.INSTANCE.readValue(body, Map.class);
                putReachEvent(reachEvent);
            } catch (Exception e) {
                // one malformed record must not fail the rest of the SQS batch
                logger.log("Skipping unprocessable record: " + e.getMessage());
            }
        }
        return null;
    }

    private void putReachEvent(Map<String, Object> reachEvent) {
        String type = String.valueOf(reachEvent.get("type"));
        String timestamp = String.valueOf(reachEvent.get("timestamp"));

        Map<String, AttributeValue> item = new LinkedHashMap<>(AttributeValues.fromMap(reachEvent));
        item.put("eventTypeTimestamp", AttributeValue.builder().s(type + "#" + timestamp).build());

        dynamoDbClient.putItem(PutItemRequest.builder()
                .tableName(stageTable)
                .item(item)
                .build());
    }
}
