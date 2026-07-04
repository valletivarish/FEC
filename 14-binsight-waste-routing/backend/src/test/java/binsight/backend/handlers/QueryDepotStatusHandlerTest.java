package binsight.backend.handlers;

import com.amazonaws.services.lambda.runtime.Context;
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

import java.util.List;
import java.util.Map;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.when;

@ExtendWith(MockitoExtension.class)
class QueryDepotStatusHandlerTest {

    private static final ObjectMapper MAPPER = new ObjectMapper();

    @Mock
    private DynamoDbClient dynamoDbClient;

    @Mock
    private Context context;

    private QueryDepotStatusHandler handler;

    @BeforeEach
    void setUp() {
        handler = new QueryDepotStatusHandler(dynamoDbClient);
    }

    @Test
    void returns200CombiningAllThreeTableResults() throws Exception {
        Map<String, AttributeValue> clusterItem = Map.of(
                "binId", AttributeValue.builder().s("bin-01").build(),
                "verdict", AttributeValue.builder().s("INCONSISTENT").build());
        Map<String, AttributeValue> fireRiskItem = Map.of(
                "binId", AttributeValue.builder().s("bin-05").build(),
                "riskStatus", AttributeValue.builder().s("CRITICAL").build());
        Map<String, AttributeValue> workListItem = Map.of(
                "depotId", AttributeValue.builder().s("depot-01").build(),
                "timestamp", AttributeValue.builder().s("2026-07-02T14:00:00Z").build(),
                "latestWeighbridgeTonnage", AttributeValue.builder().n("12.5").build());

        when(dynamoDbClient.scan(any(ScanRequest.class)))
                .thenReturn(ScanResponse.builder().items(List.of(clusterItem)).build())
                .thenReturn(ScanResponse.builder().items(List.of(fireRiskItem)).build());
        when(dynamoDbClient.query(any(QueryRequest.class)))
                .thenReturn(QueryResponse.builder().items(List.of(workListItem)).build());

        Map<String, Object> response = handler.handleRequest(Map.of(), context);

        assertEquals(200, response.get("statusCode"));

        JsonNode body = MAPPER.readTree((String) response.get("body"));
        assertTrue(body.get("clusterVerdicts").isArray());
        assertEquals(1, body.get("clusterVerdicts").size());
        assertEquals("bin-01", body.get("clusterVerdicts").get(0).get("binId").asText());

        assertTrue(body.get("fireRiskEvents").isArray());
        assertEquals("bin-05", body.get("fireRiskEvents").get(0).get("binId").asText());

        assertEquals("depot-01", body.get("latestWorkList").get("depotId").asText());
        assertEquals("12.5", body.get("latestWorkList").get("latestWeighbridgeTonnage").asText());
    }

    @Test
    void latestWorkListIsNullWhenWorkListTableEmpty() throws Exception {
        when(dynamoDbClient.scan(any(ScanRequest.class)))
                .thenReturn(ScanResponse.builder().items(List.of()).build())
                .thenReturn(ScanResponse.builder().items(List.of()).build());
        when(dynamoDbClient.query(any(QueryRequest.class)))
                .thenReturn(QueryResponse.builder().items(List.of()).build());

        Map<String, Object> response = handler.handleRequest(Map.of(), context);

        assertEquals(200, response.get("statusCode"));
        JsonNode body = MAPPER.readTree((String) response.get("body"));
        assertTrue(body.get("latestWorkList").isNull());
    }

    @Test
    void queriesWorkListTableForDepot01LatestOnly() {
        when(dynamoDbClient.scan(any(ScanRequest.class)))
                .thenReturn(ScanResponse.builder().items(List.of()).build())
                .thenReturn(ScanResponse.builder().items(List.of()).build());
        when(dynamoDbClient.query(any(QueryRequest.class)))
                .thenReturn(QueryResponse.builder().items(List.of()).build());

        handler.handleRequest(Map.of(), context);

        org.mockito.ArgumentCaptor<QueryRequest> captor = org.mockito.ArgumentCaptor.forClass(QueryRequest.class);
        org.mockito.Mockito.verify(dynamoDbClient).query(captor.capture());

        QueryRequest request = captor.getValue();
        assertEquals("depot-01", request.expressionAttributeValues().get(":depotId").s());
        assertEquals(Boolean.FALSE, request.scanIndexForward());
        assertEquals(1, request.limit());
    }
}
