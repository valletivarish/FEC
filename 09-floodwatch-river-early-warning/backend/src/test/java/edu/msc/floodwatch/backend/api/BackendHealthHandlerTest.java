package edu.msc.floodwatch.backend.api;

import com.amazonaws.services.lambda.runtime.Context;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;
import software.amazon.awssdk.services.dynamodb.DynamoDbClient;
import software.amazon.awssdk.services.dynamodb.model.DescribeTableRequest;
import software.amazon.awssdk.services.dynamodb.model.DescribeTableResponse;
import software.amazon.awssdk.services.sqs.SqsClient;
import software.amazon.awssdk.services.sqs.model.GetQueueAttributesRequest;
import software.amazon.awssdk.services.sqs.model.GetQueueAttributesResponse;
import software.amazon.awssdk.services.sqs.model.QueueAttributeName;

import java.util.Map;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.when;

@ExtendWith(MockitoExtension.class)
class BackendHealthHandlerTest {

    private static final String TABLE = "floodwatch-reach-stage";
    private static final String QUEUE_URL = "http://localhost:4566/000000000000/floodwatch-gauge-intake-queue";

    @Mock
    private DynamoDbClient dynamoDbClient;

    @Mock
    private SqsClient sqsClient;

    @Mock
    private Context context;

    private BackendHealthHandler handler;

    @BeforeEach
    void setUp() {
        handler = new BackendHealthHandler(dynamoDbClient, sqsClient, TABLE, QUEUE_URL);
    }

    @Test
    void reportsConnectedWhenBothDependenciesRespond() {
        when(dynamoDbClient.describeTable(any(DescribeTableRequest.class)))
                .thenReturn(DescribeTableResponse.builder().build());
        when(sqsClient.getQueueAttributes(any(GetQueueAttributesRequest.class)))
                .thenReturn(GetQueueAttributesResponse.builder()
                        .attributes(Map.of(QueueAttributeName.APPROXIMATE_NUMBER_OF_MESSAGES, "3"))
                        .build());

        Map<String, Object> response = handler.handleRequest(Map.of(), context);

        assertEquals(200, response.get("statusCode"));
        String body = (String) response.get("body");
        assertTrue(body.contains("\"databaseStatus\":\"Connected\""));
        assertTrue(body.contains("\"queueStatus\":\"Connected\""));
        assertTrue(body.contains("\"queueApproximateDepth\":3"));
        assertTrue(body.contains("\"cloudConnectionStatus\":\"Connected\""));
    }

    @Test
    void reportsUnavailableWhenDynamoDescribeTableThrows() {
        when(dynamoDbClient.describeTable(any(DescribeTableRequest.class)))
                .thenThrow(new RuntimeException("table not found"));
        when(sqsClient.getQueueAttributes(any(GetQueueAttributesRequest.class)))
                .thenReturn(GetQueueAttributesResponse.builder()
                        .attributes(Map.of(QueueAttributeName.APPROXIMATE_NUMBER_OF_MESSAGES, "0"))
                        .build());

        Map<String, Object> response = handler.handleRequest(Map.of(), context);

        assertEquals(200, response.get("statusCode"));
        String body = (String) response.get("body");
        assertTrue(body.contains("\"databaseStatus\":\"Unavailable\""));
        assertTrue(body.contains("\"cloudConnectionStatus\":\"Degraded\""));
    }

    @Test
    void reportsUnavailableWhenQueueAttributesThrow() {
        when(dynamoDbClient.describeTable(any(DescribeTableRequest.class)))
                .thenReturn(DescribeTableResponse.builder().build());
        when(sqsClient.getQueueAttributes(any(GetQueueAttributesRequest.class)))
                .thenThrow(new RuntimeException("queue unreachable"));

        Map<String, Object> response = handler.handleRequest(Map.of(), context);

        String body = (String) response.get("body");
        assertTrue(body.contains("\"queueStatus\":\"Unavailable\""));
        assertTrue(body.contains("\"queueApproximateDepth\":0"));
    }
}
