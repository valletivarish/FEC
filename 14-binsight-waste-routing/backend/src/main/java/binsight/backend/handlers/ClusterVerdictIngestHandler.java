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
 * SQS-triggered: persists each cluster_verdict event from BinClusterNode, keyed by
 * binId/timestamp so a bin's verdict history is queryable in chronological order.
 */
public class ClusterVerdictIngestHandler implements RequestHandler<Map<String, Object>, Void> {

    private final DynamoDbClient dynamoDbClient;
    private final String clusterTable;

    public ClusterVerdictIngestHandler() {
        this(DynamoDbClient.builder().build());
    }

    public ClusterVerdictIngestHandler(DynamoDbClient dynamoDbClient) {
        this.dynamoDbClient = dynamoDbClient;
        this.clusterTable = System.getenv("BINSIGHT_CLUSTER_TABLE");
    }

    @Override
    @SuppressWarnings("unchecked")
    public Void handleRequest(Map<String, Object> event, Context context) {
        LambdaLogger logger = context.getLogger();
        List<Map<String, Object>> records = (List<Map<String, Object>>) event.getOrDefault("Records", List.of());

        for (Map<String, Object> record : records) {
            try {
                String body = String.valueOf(record.get("body"));
                Map<String, Object> verdictEvent = JsonCodec.MAPPER.readValue(body, Map.class);
                putVerdictEvent(verdictEvent);
            } catch (Exception e) {
                // one bad record must not sink the rest of the SQS batch
                logger.log("Skipping malformed cluster verdict record: " + e.getMessage());
            }
        }
        return null;
    }

    private void putVerdictEvent(Map<String, Object> verdictEvent) {
        Map<String, AttributeValue> item = DynamoItemConverter.toAttributeMap(verdictEvent);
        item.put("binId", AttributeValue.builder().s(String.valueOf(verdictEvent.get("binId"))).build());
        item.put("timestamp", AttributeValue.builder().s(String.valueOf(verdictEvent.get("timestamp"))).build());

        dynamoDbClient.putItem(PutItemRequest.builder()
                .tableName(clusterTable)
                .item(item)
                .build());
    }
}
