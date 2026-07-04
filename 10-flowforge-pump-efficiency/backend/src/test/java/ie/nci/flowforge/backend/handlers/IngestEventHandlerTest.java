package ie.nci.flowforge.backend.handlers;

import com.amazonaws.services.lambda.runtime.Context;
import com.amazonaws.services.lambda.runtime.LambdaLogger;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.ArgumentCaptor;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;
import software.amazon.awssdk.services.dynamodb.DynamoDbClient;
import software.amazon.awssdk.services.dynamodb.model.PutItemRequest;
import software.amazon.awssdk.services.dynamodb.model.PutItemResponse;

import java.util.List;
import java.util.Map;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

@ExtendWith(MockitoExtension.class)
class IngestEventHandlerTest {

    @Mock
    private DynamoDbClient dynamoDbClient;

    @Mock
    private Context context;

    @Mock
    private LambdaLogger logger;

    private IngestEventHandler handler;

    @BeforeEach
    void setUp() {
        handler = new IngestEventHandler(dynamoDbClient);
    }

    private Map<String, Object> sqsEvent(String... bodies) {
        return Map.of("Records", List.of(bodies).stream()
                .map(b -> (Map<String, Object>) Map.<String, Object>of("body", b))
                .toList());
    }

    @Test
    void writesHealthEventWithCompositeSortKey() {
        when(dynamoDbClient.putItem(any(PutItemRequest.class))).thenReturn(PutItemResponse.builder().build());

        String body = "{\"type\":\"health_event\",\"pumpId\":\"pump-01\",\"trigger\":\"mad_anomaly\","
                + "\"madScore\":4.1,\"vibration\":8.2,\"bearingTemp\":60.0,\"motorCurrent\":20.0,"
                + "\"rpm\":1500,\"timestamp\":\"2026-01-01T00:00:00Z\"}";

        handler.handleRequest(sqsEvent(body), context);

        ArgumentCaptor<PutItemRequest> captor = ArgumentCaptor.forClass(PutItemRequest.class);
        verify(dynamoDbClient).putItem(captor.capture());

        PutItemRequest request = captor.getValue();
        assertEquals("pump-01", request.item().get("pumpId").s());
        assertEquals("health_event#2026-01-01T00:00:00Z", request.item().get("eventTypeTimestamp").s());
    }

    @Test
    void writesHydraulicsEventWithCompositeSortKey() {
        when(dynamoDbClient.putItem(any(PutItemRequest.class))).thenReturn(PutItemResponse.builder().build());

        String body = "{\"type\":\"hydraulics_event\",\"pumpId\":\"pump-02\",\"severity\":\"CRITICAL\","
                + "\"efficiency\":0.4,\"predictedEfficiency\":0.6,\"deviationPercentagePoints\":22.0,"
                + "\"timestamp\":\"2026-01-01T00:05:00Z\"}";

        handler.handleRequest(sqsEvent(body), context);

        ArgumentCaptor<PutItemRequest> captor = ArgumentCaptor.forClass(PutItemRequest.class);
        verify(dynamoDbClient).putItem(captor.capture());

        assertEquals("hydraulics_event#2026-01-01T00:05:00Z",
                captor.getValue().item().get("eventTypeTimestamp").s());
        assertEquals("pump-02", captor.getValue().item().get("pumpId").s());
    }

    @Test
    void writesIntegrityEventWithCompositeSortKey() {
        when(dynamoDbClient.putItem(any(PutItemRequest.class))).thenReturn(PutItemResponse.builder().build());

        String body = "{\"type\":\"integrity_event\",\"pumpId\":\"pump-03\",\"state\":\"LEAK_WATCH\","
                + "\"sealLeak\":32.5,\"trendSlope\":0.1,\"timestamp\":\"2026-01-01T00:10:00Z\"}";

        handler.handleRequest(sqsEvent(body), context);

        ArgumentCaptor<PutItemRequest> captor = ArgumentCaptor.forClass(PutItemRequest.class);
        verify(dynamoDbClient).putItem(captor.capture());

        assertEquals("integrity_event#2026-01-01T00:10:00Z",
                captor.getValue().item().get("eventTypeTimestamp").s());
        assertEquals("pump-03", captor.getValue().item().get("pumpId").s());
    }

    @Test
    void toleratesOneMalformedRecordWithoutCrashingBatch() {
        when(context.getLogger()).thenReturn(logger);
        when(dynamoDbClient.putItem(any(PutItemRequest.class))).thenReturn(PutItemResponse.builder().build());

        String goodBody = "{\"type\":\"health_event\",\"pumpId\":\"pump-01\",\"trigger\":\"heartbeat\","
                + "\"madScore\":0.0,\"vibration\":2.0,\"bearingTemp\":50.0,\"motorCurrent\":15.0,"
                + "\"rpm\":1400,\"timestamp\":\"2026-01-01T01:00:00Z\"}";
        String malformedBody = "{not valid json";

        handler.handleRequest(sqsEvent(malformedBody, goodBody), context);

        verify(dynamoDbClient).putItem(any(PutItemRequest.class));
        verify(logger).log(org.mockito.ArgumentMatchers.contains("Skipping malformed insight record"));
    }
}
