package ie.nci.flowforge.backend.handlers;

import com.amazonaws.services.lambda.runtime.Context;
import com.fasterxml.jackson.databind.JsonNode;
import ie.nci.flowforge.backend.support.JsonCodec;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;
import software.amazon.awssdk.services.dynamodb.DynamoDbClient;
import software.amazon.awssdk.services.dynamodb.model.AttributeValue;
import software.amazon.awssdk.services.dynamodb.model.QueryRequest;
import software.amazon.awssdk.services.dynamodb.model.QueryResponse;

import java.util.List;
import java.util.Map;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.when;

@ExtendWith(MockitoExtension.class)
class QueryApiHandlerTest {

    @Mock
    private DynamoDbClient dynamoDbClient;

    @Mock
    private Context context;

    private QueryApiHandler handler;

    @BeforeEach
    void setUp() {
        handler = new QueryApiHandler(dynamoDbClient);
    }

    @Test
    void returnsWellFormedProxyResponseFromQueryResult() throws Exception {
        Map<String, AttributeValue> storedItem = Map.of(
                "pumpId", AttributeValue.builder().s("pump-01").build(),
                "eventTypeTimestamp", AttributeValue.builder().s("health_event#2026-01-01T00:00:00Z").build(),
                "trigger", AttributeValue.builder().s("mad_anomaly").build(),
                "vibration", AttributeValue.builder().n("8.2").build()
        );
        QueryResponse queryResponse = QueryResponse.builder().items(List.of(storedItem)).build();
        when(dynamoDbClient.query(any(QueryRequest.class))).thenReturn(queryResponse);

        Map<String, Object> event = Map.of("pathParameters", Map.of("pumpId", "pump-01"));
        Map<String, Object> response = handler.handleRequest(event, context);

        assertEquals(200, response.get("statusCode"));

        JsonNode body = JsonCodec.MAPPER.readTree((String) response.get("body"));
        assertEquals("pump-01", body.get("pumpId").asText());
        assertTrue(body.get("insights").isArray());
        assertEquals(1, body.get("insights").size());
        assertEquals("mad_anomaly", body.get("insights").get(0).get("trigger").asText());
    }

    @Test
    void queriesUsingPumpIdFromPathParameters() {
        when(dynamoDbClient.query(any(QueryRequest.class)))
                .thenReturn(QueryResponse.builder().items(List.of()).build());

        Map<String, Object> event = Map.of("pathParameters", Map.of("pumpId", "pump-02"));
        handler.handleRequest(event, context);

        org.mockito.ArgumentCaptor<QueryRequest> captor = org.mockito.ArgumentCaptor.forClass(QueryRequest.class);
        org.mockito.Mockito.verify(dynamoDbClient).query(captor.capture());
        assertEquals("pump-02", captor.getValue().expressionAttributeValues().get(":pumpId").s());
    }
}
