package edu.msc.floodwatch.backend.ingest;

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

import java.util.List;
import java.util.Map;

import static org.junit.jupiter.api.Assertions.assertDoesNotThrow;
import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.lenient;
import static org.mockito.Mockito.times;
import static org.mockito.Mockito.verify;

@ExtendWith(MockitoExtension.class)
class ReachIntakeHandlerTest {

    private static final String TABLE = "floodwatch-reach-stage";

    @Mock
    private DynamoDbClient dynamoDbClient;

    @Mock
    private Context context;

    @Mock
    private LambdaLogger logger;

    private ReachIntakeHandler handler;

    @BeforeEach
    void setUp() {
        lenient().when(context.getLogger()).thenReturn(logger);
        handler = new ReachIntakeHandler(dynamoDbClient, TABLE);
    }

    @Test
    void writesHydroEventWithCompositeSortKey() {
        String body = "{\"type\":\"hydro_event\",\"reachId\":\"reach-upper\",\"stage\":\"AMBER\","
                + "\"riverLevel\":3.4,\"rateOfRise\":0.12,\"soilSaturationAmplified\":false,"
                + "\"crossReachEscalated\":false,\"timestamp\":\"2026-07-02T10:00:00Z\"}";
        Map<String, Object> event = Map.of("Records", List.of(Map.of("body", body)));

        handler.handleRequest(event, context);

        ArgumentCaptor<PutItemRequest> captor = ArgumentCaptor.forClass(PutItemRequest.class);
        verify(dynamoDbClient, times(1)).putItem(captor.capture());

        PutItemRequest request = captor.getValue();
        assertEquals(TABLE, request.tableName());
        Map<String, AttributeValue> item = request.item();
        assertEquals("reach-upper", item.get("reachId").s());
        assertEquals("hydro_event#2026-07-02T10:00:00Z", item.get("eventTypeTimestamp").s());
        assertEquals("AMBER", item.get("stage").s());
    }

    @Test
    void writesQualityEventWithCompositeSortKey() {
        String body = "{\"type\":\"quality_event\",\"reachId\":\"reach-mid\",\"cwqi\":62.5,"
                + "\"band\":\"FAIR\",\"timestamp\":\"2026-07-02T10:05:00Z\"}";
        Map<String, Object> event = Map.of("Records", List.of(Map.of("body", body)));

        handler.handleRequest(event, context);

        ArgumentCaptor<PutItemRequest> captor = ArgumentCaptor.forClass(PutItemRequest.class);
        verify(dynamoDbClient, times(1)).putItem(captor.capture());
        assertEquals("quality_event#2026-07-02T10:05:00Z", captor.getValue().item().get("eventTypeTimestamp").s());
    }

    @Test
    void writesMeteoEventWithCompositeSortKey() {
        String body = "{\"type\":\"meteo_event\",\"reachId\":\"reach-lower\",\"pressureSlope\":-0.6,"
                + "\"preStormSignal\":true,\"preWarnEscalation\":false,\"timestamp\":\"2026-07-02T10:10:00Z\"}";
        Map<String, Object> event = Map.of("Records", List.of(Map.of("body", body)));

        handler.handleRequest(event, context);

        ArgumentCaptor<PutItemRequest> captor = ArgumentCaptor.forClass(PutItemRequest.class);
        verify(dynamoDbClient, times(1)).putItem(captor.capture());
        assertEquals("meteo_event#2026-07-02T10:10:00Z", captor.getValue().item().get("eventTypeTimestamp").s());
    }

    @Test
    void malformedRecordIsSkippedWithoutCrashingBatch() {
        Map<String, Object> goodRecord = Map.of("body",
                "{\"type\":\"hydro_event\",\"reachId\":\"reach-upper\",\"stage\":\"GREEN\","
                        + "\"timestamp\":\"2026-07-02T10:00:00Z\"}");
        Map<String, Object> badRecord = Map.of("body", "not valid json");
        Map<String, Object> event = Map.of("Records", List.of(badRecord, goodRecord));

        assertDoesNotThrow(() -> handler.handleRequest(event, context));

        verify(dynamoDbClient, times(1)).putItem(any(PutItemRequest.class));
    }
}
