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
class ClusterVerdictIngestHandlerTest {

    @Mock
    private DynamoDbClient dynamoDbClient;

    @Mock
    private Context context;

    @Mock
    private LambdaLogger logger;

    private ClusterVerdictIngestHandler handler;

    @BeforeEach
    void setUp() {
        lenient().when(context.getLogger()).thenReturn(logger);
        handler = new ClusterVerdictIngestHandler(dynamoDbClient);
    }

    private Map<String, Object> sqsEvent(String... bodies) {
        return Map.of("Records", List.of(bodies).stream()
                .map(b -> (Map<String, Object>) Map.<String, Object>of("body", b))
                .toList());
    }

    @Test
    void writesClusterVerdictWithCorrectPartitionAndSortKey() {
        when(dynamoDbClient.putItem(any(PutItemRequest.class))).thenReturn(PutItemResponse.builder().build());

        String body = "{\"type\":\"cluster_verdict\",\"binId\":\"bin-01\",\"verdict\":\"INCONSISTENT\","
                + "\"fillLevelPct\":92.0,\"binWeightKg\":15.0,\"expectedWeightKg\":220.8,"
                + "\"timestamp\":\"2026-07-02T10:00:00Z\"}";

        handler.handleRequest(sqsEvent(body), context);

        ArgumentCaptor<PutItemRequest> captor = ArgumentCaptor.forClass(PutItemRequest.class);
        verify(dynamoDbClient).putItem(captor.capture());

        Map<String, AttributeValue> item = captor.getValue().item();
        assertEquals("bin-01", item.get("binId").s());
        assertEquals("2026-07-02T10:00:00Z", item.get("timestamp").s());
        assertEquals("INCONSISTENT", item.get("verdict").s());
        assertEquals("92.0", item.get("fillLevelPct").n());
        assertEquals("15.0", item.get("binWeightKg").n());
        assertEquals("220.8", item.get("expectedWeightKg").n());
    }

    @Test
    void toleratesOneMalformedRecordWithoutCrashingBatch() {
        when(dynamoDbClient.putItem(any(PutItemRequest.class))).thenReturn(PutItemResponse.builder().build());

        String goodBody = "{\"type\":\"cluster_verdict\",\"binId\":\"bin-02\",\"verdict\":\"POSSIBLE_FALSE_FULL\","
                + "\"fillLevelPct\":88.0,\"binWeightKg\":5.0,\"expectedWeightKg\":211.2,"
                + "\"timestamp\":\"2026-07-02T11:00:00Z\"}";
        String malformedBody = "{not valid json";

        handler.handleRequest(sqsEvent(malformedBody, goodBody), context);

        verify(dynamoDbClient).putItem(any(PutItemRequest.class));
        verify(logger).log(contains("Skipping malformed cluster verdict record"));
    }
}
