package com.guardianedge.backend.handlers;

import com.amazonaws.services.lambda.runtime.Context;
import com.amazonaws.services.lambda.runtime.LambdaLogger;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.junit.jupiter.api.BeforeEach;
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
import software.amazon.awssdk.services.dynamodb.model.UpdateItemRequest;
import software.amazon.awssdk.services.dynamodb.model.UpdateItemResponse;

import java.util.List;
import java.util.Map;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.lenient;
import static org.mockito.Mockito.when;

@ExtendWith(MockitoExtension.class)
class QueryResidentsHandlerTest {

    @Mock
    private DynamoDbClient dynamoDbClient;

    @Mock
    private Context context;

    @Mock
    private LambdaLogger logger;

    private QueryResidentsHandler handler;
    private final ObjectMapper objectMapper = new ObjectMapper();

    @BeforeEach
    void setUp() {
        lenient().when(context.getLogger()).thenReturn(logger);
        handler = new QueryResidentsHandler(dynamoDbClient);
    }

    @Test
    void listResidentsReturnsRosterAsJsonArray() throws Exception {
        Map<String, AttributeValue> item = Map.of(
                "residentId", AttributeValue.builder().s("resident-01").build(),
                "currentRiskState", AttributeValue.builder().s("NORMAL").build()
        );
        when(dynamoDbClient.scan(any(ScanRequest.class)))
                .thenReturn(ScanResponse.builder().items(List.of(item)).build());

        Map<String, Object> event = Map.of("routeKey", "GET /residents");
        Map<String, Object> result = handler.handleRequest(event, context);

        assertEquals(200, result.get("statusCode"));
        JsonNode body = objectMapper.readTree((String) result.get("body"));
        assertTrue(body.isArray());
        assertEquals("resident-01", body.get(0).get("residentId").asText());
    }

    @Test
    void residentHistoryReturnsSortedMostRecentFirst() throws Exception {
        Map<String, AttributeValue> older = Map.of(
                "residentId", AttributeValue.builder().s("resident-01").build(),
                "eventTypeTimestamp", AttributeValue.builder().s("fall_event#2026-07-01T10:00:00Z").build()
        );
        Map<String, AttributeValue> newer = Map.of(
                "residentId", AttributeValue.builder().s("resident-01").build(),
                "eventTypeTimestamp", AttributeValue.builder().s("fall_event#2026-07-02T10:00:00Z").build()
        );
        when(dynamoDbClient.query(any(QueryRequest.class)))
                .thenReturn(QueryResponse.builder().items(List.of(older, newer)).build());

        Map<String, Object> event = Map.of(
                "routeKey", "GET /residents/{residentId}/history",
                "pathParameters", Map.of("residentId", "resident-01")
        );
        Map<String, Object> result = handler.handleRequest(event, context);

        assertEquals(200, result.get("statusCode"));
        JsonNode body = objectMapper.readTree((String) result.get("body"));
        assertEquals("fall_event#2026-07-02T10:00:00Z", body.get(0).get("eventTypeTimestamp").asText());
        assertEquals("fall_event#2026-07-01T10:00:00Z", body.get(1).get("eventTypeTimestamp").asText());
    }

    @Test
    void acknowledgeClearsNeedsAcknowledgementAndResetsCount() throws Exception {
        Map<String, AttributeValue> updated = Map.of(
                "residentId", AttributeValue.builder().s("resident-01").build(),
                "needsAcknowledgement", AttributeValue.builder().bool(false).build(),
                "activeCriticalAlertCount", AttributeValue.builder().n("0").build()
        );
        when(dynamoDbClient.updateItem(any(UpdateItemRequest.class)))
                .thenReturn(UpdateItemResponse.builder().attributes(updated).build());

        Map<String, Object> event = Map.of(
                "routeKey", "POST /residents/{residentId}/acknowledge",
                "pathParameters", Map.of("residentId", "resident-01")
        );
        Map<String, Object> result = handler.handleRequest(event, context);

        assertEquals(200, result.get("statusCode"));
        JsonNode body = objectMapper.readTree((String) result.get("body"));
        assertEquals(false, body.get("needsAcknowledgement").asBoolean());
        assertEquals("0", body.get("activeCriticalAlertCount").asText());
    }

    @Test
    void unknownRouteReturns404() throws Exception {
        Map<String, Object> event = Map.of("routeKey", "DELETE /residents");
        Map<String, Object> result = handler.handleRequest(event, context);

        assertEquals(404, result.get("statusCode"));
    }
}
