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
import software.amazon.awssdk.services.dynamodb.model.QueryRequest;
import software.amazon.awssdk.services.dynamodb.model.QueryResponse;
import software.amazon.awssdk.services.dynamodb.model.ScanRequest;
import software.amazon.awssdk.services.dynamodb.model.ScanResponse;

import java.util.List;
import java.util.Map;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.lenient;
import static org.mockito.Mockito.when;

@ExtendWith(MockitoExtension.class)
class FleetHealthHandlerTest {

    @Mock
    private DynamoDbClient dynamoDbClient;

    @Mock
    private Context context;

    @Test
    void returns200WithShipmentsArrayShapedForTheManifestView() {
        ScanResponse scanResponse = ScanResponse.builder()
                .items(List.of(
                        Map.of(
                                "shipmentId", AttributeValue.builder().s("truck-1-2026-07-02").build(),
                                "truckId", AttributeValue.builder().s("truck-1").build(),
                                "complianceStatus", AttributeValue.builder().s("BREACH").build(),
                                "latestZone1Temp", AttributeValue.builder().n("-9.1").build(),
                                "setpointC", AttributeValue.builder().n("-18.0").build()
                        )
                ))
                .build();
        when(dynamoDbClient.scan(any(ScanRequest.class))).thenReturn(scanResponse);

        QueryResponse queryResponse = QueryResponse.builder()
                .items(List.of(
                        Map.of("value", AttributeValue.builder().n("-18.0").build()),
                        Map.of("value", AttributeValue.builder().n("-12.0").build())
                ))
                .build();
        lenient().when(dynamoDbClient.query(any(QueryRequest.class))).thenReturn(queryResponse);

        FleetHealthHandler handler = new FleetHealthHandler(dynamoDbClient, "ChainFrostShipments", "ChainFrostZoneTemperatureSeries");
        APIGatewayProxyResponseEvent response = handler.handleRequest(new APIGatewayProxyRequestEvent(), context);

        assertEquals(200, response.getStatusCode());
        String body = response.getBody();
        assertTrue(body.contains("\"shipments\""));
        assertTrue(body.contains("truck-1-2026-07-02"));
        assertTrue(body.contains("\"zoneTempC\":-9.1"));
        assertTrue(body.contains("\"setpointC\":-18.0"));
        assertTrue(body.contains("\"zoneTempSparkline\":[-18.0,-12.0]"));
        assertFalse(body.contains("activeFaults"), "response must not carry over the old fault-scan contract");
    }

    @Test
    void returnsEmptyShipmentsArrayWhenTableIsEmpty() {
        when(dynamoDbClient.scan(any(ScanRequest.class))).thenReturn(ScanResponse.builder().build());

        FleetHealthHandler handler = new FleetHealthHandler(dynamoDbClient, "ChainFrostShipments", "ChainFrostZoneTemperatureSeries");
        APIGatewayProxyResponseEvent response = handler.handleRequest(new APIGatewayProxyRequestEvent(), context);

        assertEquals(200, response.getStatusCode());
        assertTrue(response.getBody().contains("\"shipments\":[]"));
    }

    @Test
    void defaultsComplianceStatusToOkWhenMissing() {
        ScanResponse scanResponse = ScanResponse.builder()
                .items(List.of(
                        Map.of(
                                "shipmentId", AttributeValue.builder().s("truck-2-2026-07-02").build(),
                                "truckId", AttributeValue.builder().s("truck-2").build()
                        )
                ))
                .build();
        when(dynamoDbClient.scan(any(ScanRequest.class))).thenReturn(scanResponse);
        lenient().when(dynamoDbClient.query(any(QueryRequest.class))).thenReturn(QueryResponse.builder().build());

        FleetHealthHandler handler = new FleetHealthHandler(dynamoDbClient, "ChainFrostShipments", "ChainFrostZoneTemperatureSeries");
        APIGatewayProxyResponseEvent response = handler.handleRequest(new APIGatewayProxyRequestEvent(), context);

        assertTrue(response.getBody().contains("\"complianceStatus\":\"OK\""));
    }
}
