package edu.msc.floodwatch.backend.api;

import com.amazonaws.services.lambda.runtime.Context;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;
import software.amazon.awssdk.services.dynamodb.DynamoDbClient;
import software.amazon.awssdk.services.dynamodb.model.ScanRequest;
import software.amazon.awssdk.services.dynamodb.model.ScanResponse;

import java.util.Map;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.times;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

@ExtendWith(MockitoExtension.class)
class BackendMetricsHandlerTest {

    private static final String TABLE = "floodwatch-reach-stage";

    @Mock
    private DynamoDbClient dynamoDbClient;

    @Mock
    private Context context;

    private BackendMetricsHandler handler;

    @BeforeEach
    void setUp() {
        handler = new BackendMetricsHandler(dynamoDbClient, TABLE);
    }

    @Test
    void returnsCountFromSingleScanPage() {
        when(dynamoDbClient.scan(any(ScanRequest.class)))
                .thenReturn(ScanResponse.builder().count(42).lastEvaluatedKey(Map.of()).build());

        Map<String, Object> response = handler.handleRequest(Map.of(), context);

        assertEquals(200, response.get("statusCode"));
        String body = (String) response.get("body");
        assertTrue(body.contains("\"messagesReceived\":42"));
        assertTrue(body.contains("\"messagesStored\":42"));
    }

    @Test
    void sumsAcrossPaginatedScanPages() {
        Map<String, software.amazon.awssdk.services.dynamodb.model.AttributeValue> continuationKey =
                Map.of("reachId", software.amazon.awssdk.services.dynamodb.model.AttributeValue.builder().s("reach-upper").build());

        when(dynamoDbClient.scan(any(ScanRequest.class)))
                .thenReturn(ScanResponse.builder().count(25).lastEvaluatedKey(continuationKey).build())
                .thenReturn(ScanResponse.builder().count(17).lastEvaluatedKey(Map.of()).build());

        Map<String, Object> response = handler.handleRequest(Map.of(), context);

        String body = (String) response.get("body");
        assertTrue(body.contains("\"messagesReceived\":42"));
        verify(dynamoDbClient, times(2)).scan(any(ScanRequest.class));
    }

    @Test
    void serverErrorReturnedWhenScanThrows() {
        when(dynamoDbClient.scan(any(ScanRequest.class))).thenThrow(new RuntimeException("table missing"));

        Map<String, Object> response = handler.handleRequest(Map.of(), context);

        assertEquals(500, response.get("statusCode"));
        assertTrue(((String) response.get("body")).contains("table missing"));
    }
}
