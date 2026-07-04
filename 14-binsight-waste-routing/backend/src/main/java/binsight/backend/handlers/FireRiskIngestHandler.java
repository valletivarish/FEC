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
 * SQS-triggered: persists each fire_risk_alert event from BinSafetyNode, keyed by
 * binId/timestamp so a bin's risk history is queryable in chronological order.
 */
public class FireRiskIngestHandler implements RequestHandler<Map<String, Object>, Void> {

    private final DynamoDbClient dynamoDbClient;
    private final String fireRiskTable;

    public FireRiskIngestHandler() {
        this(DynamoDbClient.builder().build());
    }

    public FireRiskIngestHandler(DynamoDbClient dynamoDbClient) {
        this.dynamoDbClient = dynamoDbClient;
        this.fireRiskTable = System.getenv("BINSIGHT_FIRE_RISK_TABLE");
    }

    @Override
    @SuppressWarnings("unchecked")
    public Void handleRequest(Map<String, Object> event, Context context) {
        LambdaLogger logger = context.getLogger();
        List<Map<String, Object>> records = (List<Map<String, Object>>) event.getOrDefault("Records", List.of());

        for (Map<String, Object> record : records) {
            try {
                String body = String.valueOf(record.get("body"));
                Map<String, Object> riskEvent = JsonCodec.MAPPER.readValue(body, Map.class);
                putRiskEvent(riskEvent);
            } catch (Exception e) {
                // one bad record must not sink the rest of the SQS batch
                logger.log("Skipping malformed fire risk record: " + e.getMessage());
            }
        }
        return null;
    }

    private void putRiskEvent(Map<String, Object> riskEvent) {
        Map<String, AttributeValue> item = DynamoItemConverter.toAttributeMap(riskEvent);
        item.put("binId", AttributeValue.builder().s(String.valueOf(riskEvent.get("binId"))).build());
        item.put("timestamp", AttributeValue.builder().s(String.valueOf(riskEvent.get("timestamp"))).build());

        dynamoDbClient.putItem(PutItemRequest.builder()
                .tableName(fireRiskTable)
                .item(item)
                .build());
    }
}
