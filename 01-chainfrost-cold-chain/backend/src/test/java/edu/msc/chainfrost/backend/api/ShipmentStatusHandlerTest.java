package edu.msc.chainfrost.backend.api;

import com.amazonaws.services.lambda.runtime.Context;
import com.amazonaws.services.lambda.runtime.events.APIGatewayProxyRequestEvent;
import com.amazonaws.services.lambda.runtime.events.APIGatewayProxyResponseEvent;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;
import software.amazon.awssdk.services.dynamodb.DynamoDbClient;
import software.amazon.awssdk.services.dynamodb.model.AttributeValue;
import software.amazon.awssdk.services.dynamodb.model.GetItemRequest;
import software.amazon.awssdk.services.dynamodb.model.GetItemResponse;

import java.util.Map;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.when;

@ExtendWith(MockitoExtension.class)
class ShipmentStatusHandlerTest {

    @Mock
    private DynamoDbClient dynamoDbClient;

    @Mock
    private Context context;

    @Test
    void returns200WithBodyWhenShipmentExists() {
        GetItemResponse response = GetItemResponse.builder()
                .item(Map.of(
                        "shipmentId", AttributeValue.builder().s("truck-1-2026-07-02").build(),
                        "truckId", AttributeValue.builder().s("truck-1").build(),
                        "complianceStatus", AttributeValue.builder().s("OK").build()
                ))
                .build();
        when(dynamoDbClient.getItem(any(GetItemRequest.class))).thenReturn(response);

        ShipmentStatusHandler handler = new ShipmentStatusHandler(dynamoDbClient, "ChainFrostShipments");
        APIGatewayProxyRequestEvent request = new APIGatewayProxyRequestEvent()
                .withPathParameters(Map.of("shipmentId", "truck-1-2026-07-02"));

        APIGatewayProxyResponseEvent response200 = handler.handleRequest(request, context);

        assertEquals(200, response200.getStatusCode());
        assertEquals("*", response200.getHeaders().get("Access-Control-Allow-Origin"));
        assertTrue(response200.getBody().contains("truck-1"));
    }

    @Test
    void returns404WhenShipmentMissing() {
        GetItemResponse response = GetItemResponse.builder().build();
        when(dynamoDbClient.getItem(any(GetItemRequest.class))).thenReturn(response);

        ShipmentStatusHandler handler = new ShipmentStatusHandler(dynamoDbClient, "ChainFrostShipments");
        APIGatewayProxyRequestEvent request = new APIGatewayProxyRequestEvent()
                .withPathParameters(Map.of("shipmentId", "truck-unknown-2026-07-02"));

        APIGatewayProxyResponseEvent response404 = handler.handleRequest(request, context);

        assertEquals(404, response404.getStatusCode());
        assertEquals("*", response404.getHeaders().get("Access-Control-Allow-Origin"));
    }
}
