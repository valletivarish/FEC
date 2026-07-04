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
class WorkListIngestHandlerTest {

    @Mock
    private DynamoDbClient dynamoDbClient;

    @Mock
    private Context context;

    @Mock
    private LambdaLogger logger;

    private WorkListIngestHandler handler;

    @BeforeEach
    void setUp() {
        lenient().when(context.getLogger()).thenReturn(logger);
        handler = new WorkListIngestHandler(dynamoDbClient);
    }

    private Map<String, Object> sqsEvent(String... bodies) {
        return Map.of("Records", List.of(bodies).stream()
                .map(b -> (Map<String, Object>) Map.<String, Object>of("body", b))
                .toList());
    }

    @Test
    void writesWorkListEventWithCorrectPartitionAndSortKeyAndNestedItems() {
        when(dynamoDbClient.putItem(any(PutItemRequest.class))).thenReturn(PutItemResponse.builder().build());

        String body = "{\"type\":\"work_list_event\",\"depotId\":\"depot-01\","
                + "\"items\":[{\"binId\":\"bin-01\",\"priorityScore\":4.2,\"dueReasons\":[\"HIGH_FILL\"],"
                + "\"assignedTruckId\":\"truck-01\",\"dataQualityFlag\":\"NORMAL\"}],"
                + "\"latestWeighbridgeTonnage\":12.5,\"timestamp\":\"2026-07-02T14:00:00Z\"}";

        handler.handleRequest(sqsEvent(body), context);

        ArgumentCaptor<PutItemRequest> captor = ArgumentCaptor.forClass(PutItemRequest.class);
        verify(dynamoDbClient).putItem(captor.capture());

        Map<String, AttributeValue> item = captor.getValue().item();
        assertEquals("depot-01", item.get("depotId").s());
        assertEquals("2026-07-02T14:00:00Z", item.get("timestamp").s());
        assertEquals("12.5", item.get("latestWeighbridgeTonnage").n());

        List<AttributeValue> items = item.get("items").l();
        assertEquals(1, items.size());
        Map<String, AttributeValue> firstItem = items.get(0).m();
        assertEquals("bin-01", firstItem.get("binId").s());
        assertEquals("4.2", firstItem.get("priorityScore").n());
        assertEquals("truck-01", firstItem.get("assignedTruckId").s());
        assertEquals(1, firstItem.get("dueReasons").l().size());
        assertEquals("HIGH_FILL", firstItem.get("dueReasons").l().get(0).s());
    }

    @Test
    void toleratesOneMalformedRecordWithoutCrashingBatch() {
        when(dynamoDbClient.putItem(any(PutItemRequest.class))).thenReturn(PutItemResponse.builder().build());

        String goodBody = "{\"type\":\"work_list_event\",\"depotId\":\"depot-01\",\"items\":[],"
                + "\"latestWeighbridgeTonnage\":0.0,\"timestamp\":\"2026-07-02T15:00:00Z\"}";
        String malformedBody = "not json";

        handler.handleRequest(sqsEvent(malformedBody, goodBody), context);

        verify(dynamoDbClient).putItem(any(PutItemRequest.class));
        verify(logger).log(contains("Skipping malformed work list record"));
    }
}
