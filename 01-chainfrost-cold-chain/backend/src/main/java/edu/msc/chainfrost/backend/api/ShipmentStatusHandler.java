package edu.msc.chainfrost.backend.api;

import com.amazonaws.services.lambda.runtime.Context;
import com.amazonaws.services.lambda.runtime.RequestHandler;
import com.amazonaws.services.lambda.runtime.events.APIGatewayProxyRequestEvent;
import com.amazonaws.services.lambda.runtime.events.APIGatewayProxyResponseEvent;
import edu.msc.chainfrost.backend.util.JsonMapper;
import software.amazon.awssdk.services.dynamodb.DynamoDbClient;
import software.amazon.awssdk.services.dynamodb.model.AttributeValue;
import software.amazon.awssdk.services.dynamodb.model.GetItemRequest;
import software.amazon.awssdk.services.dynamodb.model.GetItemResponse;

import java.util.LinkedHashMap;
import java.util.Map;

/**
 * GET /shipments/{shipmentId} - single GetItem lookup against the
 * shipments table, returning the current rolling status snapshot.
 */
public class ShipmentStatusHandler implements RequestHandler<APIGatewayProxyRequestEvent, APIGatewayProxyResponseEvent> {

    private final DynamoDbClient dynamoDbClient;
    private final String shipmentsTable;

    public ShipmentStatusHandler() {
        this(DynamoDbClient.create(), System.getenv("CHAINFROST_SHIPMENTS_TABLE"));
    }

    public ShipmentStatusHandler(DynamoDbClient dynamoDbClient, String shipmentsTable) {
        this.dynamoDbClient = dynamoDbClient;
        this.shipmentsTable = shipmentsTable;
    }

    @Override
    public APIGatewayProxyResponseEvent handleRequest(APIGatewayProxyRequestEvent request, Context context) {
        String shipmentId = ApiResponses.pathParam(request, "shipmentId");
        try {
            GetItemResponse response = dynamoDbClient.getItem(GetItemRequest.builder()
                    .tableName(shipmentsTable)
                    .key(Map.of("shipmentId", AttributeValue.builder().s(shipmentId).build()))
                    .build());

            if (!response.hasItem() || response.item().isEmpty()) {
                return ApiResponses.notFound("{\"message\":\"shipment not found\"}");
            }

            Map<String, Object> body = new LinkedHashMap<>();
            response.item().forEach((key, value) -> body.put(key, attributeToJavaValue(value)));
            return ApiResponses.ok(JsonMapper.INSTANCE.writeValueAsString(body));
        } catch (Exception e) {
            return ApiResponses.serverError("{\"message\":\"" + e.getMessage() + "\"}");
        }
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
