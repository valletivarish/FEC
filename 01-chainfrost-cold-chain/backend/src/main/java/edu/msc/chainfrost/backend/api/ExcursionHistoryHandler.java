package edu.msc.chainfrost.backend.api;

import com.amazonaws.services.lambda.runtime.Context;
import com.amazonaws.services.lambda.runtime.RequestHandler;
import com.amazonaws.services.lambda.runtime.events.APIGatewayProxyRequestEvent;
import com.amazonaws.services.lambda.runtime.events.APIGatewayProxyResponseEvent;
import edu.msc.chainfrost.backend.util.JsonMapper;
import software.amazon.awssdk.services.dynamodb.DynamoDbClient;
import software.amazon.awssdk.services.dynamodb.model.AttributeValue;
import software.amazon.awssdk.services.dynamodb.model.QueryRequest;
import software.amazon.awssdk.services.dynamodb.model.QueryResponse;

import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

/**
 * GET /shipments/{shipmentId}/excursions - queries the zone temperature
 * series table by truckId, since that table's partition key is truckId
 * rather than shipmentId.
 */
public class ExcursionHistoryHandler implements RequestHandler<APIGatewayProxyRequestEvent, APIGatewayProxyResponseEvent> {

    private final DynamoDbClient dynamoDbClient;
    private final String zoneTempTable;

    public ExcursionHistoryHandler() {
        this(DynamoDbClient.create(), System.getenv("CHAINFROST_ZONE_TEMP_TABLE"));
    }

    public ExcursionHistoryHandler(DynamoDbClient dynamoDbClient, String zoneTempTable) {
        this.dynamoDbClient = dynamoDbClient;
        this.zoneTempTable = zoneTempTable;
    }

    @Override
    public APIGatewayProxyResponseEvent handleRequest(APIGatewayProxyRequestEvent request, Context context) {
        String shipmentId = ApiResponses.pathParam(request, "shipmentId");
        if (shipmentId == null) {
            return ApiResponses.notFound("{\"message\":\"shipmentId path param missing\"}");
        }

        String truckId = deriveTruckId(shipmentId);
        try {
            QueryResponse response = dynamoDbClient.query(QueryRequest.builder()
                    .tableName(zoneTempTable)
                    .keyConditionExpression("truckId = :truckId")
                    .expressionAttributeValues(Map.of(":truckId", AttributeValue.builder().s(truckId).build()))
                    .build());

            List<Map<String, Object>> samples = new ArrayList<>();
            for (Map<String, AttributeValue> item : response.items()) {
                Map<String, Object> sample = new LinkedHashMap<>();
                item.forEach((key, value) -> sample.put(key, attributeToJavaValue(value)));
                samples.add(sample);
            }

            return ApiResponses.ok(JsonMapper.INSTANCE.writeValueAsString(samples));
        } catch (Exception e) {
            return ApiResponses.serverError("{\"message\":\"" + e.getMessage() + "\"}");
        }
    }

    /**
     * shipmentId is truckId + "-" + yyyy-MM-dd; the date suffix itself has two
     * dashes, so the truckId is everything before the 3rd-from-last dash.
     */
    private String deriveTruckId(String shipmentId) {
        int dateStart = shipmentId.length() - "yyyy-MM-dd".length();
        if (dateStart > 1 && shipmentId.charAt(dateStart - 1) == '-') {
            return shipmentId.substring(0, dateStart - 1);
        }
        return shipmentId;
    }

    private Object attributeToJavaValue(AttributeValue value) {
        if (value.s() != null) {
            return value.s();
        }
        if (value.n() != null) {
            return Double.valueOf(value.n());
        }
        return value.toString();
    }
}
