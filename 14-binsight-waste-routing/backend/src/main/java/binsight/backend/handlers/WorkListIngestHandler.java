package binsight.backend.handlers;

import binsight.backend.support.DynamoItemConverter;
import binsight.backend.support.JsonCodec;
import com.amazonaws.services.lambda.runtime.Context;
import com.amazonaws.services.lambda.runtime.LambdaLogger;
import com.amazonaws.services.lambda.runtime.RequestHandler;
import software.amazon.awssdk.services.dynamodb.DynamoDbClient;
import software.amazon.awssdk.services.dynamodb.model.AttributeValue;
import software.amazon.awssdk.services.dynamodb.model.PutItemRequest;

import java.util.List;
import java.util.Map;

/**
 * SQS-triggered: persists each work_list_event from FleetNode, keyed by depotId/timestamp.
 * items[] is a nested list of maps, so DynamoItemConverter's recursive conversion is required
 * here (the other two ingest handlers only ever see flat scalar fields).
 */
public class WorkListIngestHandler implements RequestHandler<Map<String, Object>, Void> {

    private final DynamoDbClient dynamoDbClient;
    private final String workListTable;

    public WorkListIngestHandler() {
        this(DynamoDbClient.builder().build());
    }

    public WorkListIngestHandler(DynamoDbClient dynamoDbClient) {
        this.dynamoDbClient = dynamoDbClient;
        this.workListTable = System.getenv("BINSIGHT_WORK_LIST_TABLE");
    }

    @Override
    @SuppressWarnings("unchecked")
    public Void handleRequest(Map<String, Object> event, Context context) {
        LambdaLogger logger = context.getLogger();
        List<Map<String, Object>> records = (List<Map<String, Object>>) event.getOrDefault("Records", List.of());

        for (Map<String, Object> record : records) {
            try {
                String body = String.valueOf(record.get("body"));
                Map<String, Object> workListEvent = JsonCodec.MAPPER.readValue(body, Map.class);
                putWorkListEvent(workListEvent);
            } catch (Exception e) {
                // one bad record must not sink the rest of the SQS batch
                logger.log("Skipping malformed work list record: " + e.getMessage());
            }
        }
        return null;
    }

    private void putWorkListEvent(Map<String, Object> workListEvent) {
        Map<String, AttributeValue> item = DynamoItemConverter.toAttributeMap(workListEvent);
        item.put("depotId", AttributeValue.builder().s(String.valueOf(workListEvent.get("depotId"))).build());
        item.put("timestamp", AttributeValue.builder().s(String.valueOf(workListEvent.get("timestamp"))).build());

        dynamoDbClient.putItem(PutItemRequest.builder()
                .tableName(workListTable)
                .item(item)
                .build());
    }
}
