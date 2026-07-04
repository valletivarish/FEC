package edu.msc.floodwatch.backend.api;

import com.amazonaws.services.lambda.runtime.Context;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;
import software.amazon.awssdk.services.dynamodb.DynamoDbClient;
import software.amazon.awssdk.services.dynamodb.model.AttributeValue;
import software.amazon.awssdk.services.dynamodb.model.QueryRequest;
import software.amazon.awssdk.services.dynamodb.model.QueryResponse;

import java.util.Map;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.when;

@ExtendWith(MockitoExtension.class)
class ReachStatusHandlerTest {

    private static final String TABLE = "floodwatch-reach-stage";

    @Mock
    private DynamoDbClient dynamoDbClient;

    @Mock
    private Context context;

    private ReachStatusHandler handler;

    @BeforeEach
    void setUp() {
        handler = new ReachStatusHandler(dynamoDbClient, TABLE);
    }

    @Test
    void returnsWellFormedProxyResponseFromQueryResult() {
        Map<String, AttributeValue> item = Map.of(
                "reachId", AttributeValue.builder().s("reach-mid").build(),
                "eventTypeTimestamp", AttributeValue.builder().s("hydro_event#2026-07-02T10:00:00Z").build(),
                "stage", AttributeValue.builder().s("AMBER").build());

        when(dynamoDbClient.query(any(QueryRequest.class)))
                .thenReturn(QueryResponse.builder().items(item).build());

        Map<String, Object> event = Map.of("pathParameters", Map.of("reachId", "reach-mid"));
        Map<String, Object> response = handler.handleRequest(event, context);

        assertEquals(200, response.get("statusCode"));
        String body = (String) response.get("body");
        assertTrue(body.contains("reach-mid"));
        assertTrue(body.contains("AMBER"));
    }

    @Test
    void serverErrorReturnedWhenQueryThrows() {
        when(dynamoDbClient.query(any(QueryRequest.class))).thenThrow(new RuntimeException("table missing"));

        Map<String, Object> event = Map.of("pathParameters", Map.of("reachId", "reach-lower"));
        Map<String, Object> response = handler.handleRequest(event, context);

        assertEquals(500, response.get("statusCode"));
        assertTrue(((String) response.get("body")).contains("table missing"));
    }
}
