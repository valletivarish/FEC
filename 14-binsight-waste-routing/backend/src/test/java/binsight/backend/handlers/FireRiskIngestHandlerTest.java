package binsight.backend.handlers;

import com.amazonaws.services.lambda.runtime.Context;
import com.amazonaws.services.lambda.runtime.LambdaLogger;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.ArgumentCaptor;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;
import software.amazon.awssdk.services.dynamodb.DynamoDbClient;
import software.amazon.awssdk.services.dynamodb.model.AttributeValue;
import software.amazon.awssdk.services.dynamodb.model.PutItemRequest;
import software.amazon.awssdk.services.dynamodb.model.PutItemResponse;

import java.util.List;
import java.util.Map;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.contains;
import static org.mockito.Mockito.lenient;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

@ExtendWith(MockitoExtension.class)
class FireRiskIngestHandlerTest {

    @Mock
    private DynamoDbClient dynamoDbClient;

    @Mock
    private Context context;

    @Mock
    private LambdaLogger logger;

    private FireRiskIngestHandler handler;

    @BeforeEach
    void setUp() {
        lenient().when(context.getLogger()).thenReturn(logger);
        handler = new FireRiskIngestHandler(dynamoDbClient);
    }

    private Map<String, Object> sqsEvent(String... bodies) {
        return Map.of("Records", List.of(bodies).stream()
                .map(b -> (Map<String, Object>) Map.<String, Object>of("body", b))
                .toList());
    }

    @Test
    void writesFireRiskAlertWithCorrectPartitionAndSortKey() {
        when(dynamoDbClient.putItem(any(PutItemRequest.class))).thenReturn(PutItemResponse.builder().build());

        String body = "{\"type\":\"fire_risk_alert\",\"binId\":\"bin-05\",\"riskStatus\":\"CRITICAL\","
                + "\"riskScore\":82.5,\"medianMethanePpm\":4200.0,\"medianInternalTempC\":68.0,"
                + "\"tiltDegrees\":50.0,\"timestamp\":\"2026-07-02T12:00:00Z\"}";

        handler.handleRequest(sqsEvent(body), context);

        ArgumentCaptor<PutItemRequest> captor = ArgumentCaptor.forClass(PutItemRequest.class);
        verify(dynamoDbClient).putItem(captor.capture());

        Map<String, AttributeValue> item = captor.getValue().item();
        assertEquals("bin-05", item.get("binId").s());
        assertEquals("2026-07-02T12:00:00Z", item.get("timestamp").s());
        assertEquals("CRITICAL", item.get("riskStatus").s());
        assertEquals("82.5", item.get("riskScore").n());
        assertEquals("4200.0", item.get("medianMethanePpm").n());
        assertEquals("68.0", item.get("medianInternalTempC").n());
        assertEquals("50.0", item.get("tiltDegrees").n());
    }

    @Test
    void toleratesOneMalformedRecordWithoutCrashingBatch() {
        when(dynamoDbClient.putItem(any(PutItemRequest.class))).thenReturn(PutItemResponse.builder().build());

        String goodBody = "{\"type\":\"fire_risk_alert\",\"binId\":\"bin-06\",\"riskStatus\":\"WATCH\","
                + "\"riskScore\":45.0,\"medianMethanePpm\":2000.0,\"medianInternalTempC\":40.0,"
                + "\"tiltDegrees\":5.0,\"timestamp\":\"2026-07-02T13:00:00Z\"}";
        String malformedBody = "{{not json at all";

        handler.handleRequest(sqsEvent(malformedBody, goodBody), context);

        verify(dynamoDbClient).putItem(any(PutItemRequest.class));
        verify(logger).log(contains("Skipping malformed fire risk record"));
    }
}
