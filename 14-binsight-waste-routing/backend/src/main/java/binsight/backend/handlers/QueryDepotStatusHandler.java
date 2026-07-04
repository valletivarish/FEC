package binsight.backend.handlers;

import binsight.backend.support.DynamoItemConverter;
import binsight.backend.support.JsonCodec;
import binsight.backend.support.ProxyResponses;
import com.amazonaws.services.lambda.runtime.Context;
import com.amazonaws.services.lambda.runtime.RequestHandler;
import software.amazon.awssdk.services.dynamodb.DynamoDbClient;
import software.amazon.awssdk.services.dynamodb.model.AttributeValue;
import software.amazon.awssdk.services.dynamodb.model.QueryRequest;
import software.amazon.awssdk.services.dynamodb.model.QueryResponse;
import software.amazon.awssdk.services.dynamodb.model.ScanRequest;
import software.amazon.awssdk.services.dynamodb.model.ScanResponse;

import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

/**
 * GET /depot/status - combines the full cluster-verdict and fire-risk history with the
 * single latest work-list dispatch so the dashboard can render depot-01's live state in one call.
 */
public class QueryDepotStatusHandler implements RequestHandler<Map<String, Object>, Map<String, Object>> {

    private static final String DEPOT_ID = "depot-01";

    private final DynamoDbClient dynamoDbClient;
    private final String clusterTable;
    private final String fireRiskTable;
    private final String workListTable;

    public QueryDepotStatusHandler() {
        this(DynamoDbClient.builder().build());
    }

    public QueryDepotStatusHandler(DynamoDbClient dynamoDbClient) {
        this.dynamoDbClient = dynamoDbClient;
        this.clusterTable = System.getenv("BINSIGHT_CLUSTER_TABLE");
        this.fireRiskTable = System.getenv("BINSIGHT_FIRE_RISK_TABLE");
        this.workListTable = System.getenv("BINSIGHT_WORK_LIST_TABLE");
    }

    @Override
    public Map<String, Object> handleRequest(Map<String, Object> event, Context context) {
        try {
            List<Map<String, Object>> clusterVerdicts = scanAll(clusterTable);
            List<Map<String, Object>> fireRiskEvents = scanAll(fireRiskTable);
            Map<String, Object> latestWorkList = queryLatestWorkList();

            Map<String, Object> result = new LinkedHashMap<>();
            result.put("clusterVerdicts", clusterVerdicts);
            result.put("fireRiskEvents", fireRiskEvents);
            result.put("latestWorkList", latestWorkList);

            String body = JsonCodec.MAPPER.writeValueAsString(result);
            return ProxyResponses.ok(body);
        } catch (Exception e) {
            return ProxyResponses.error(500, "{\"message\":\"" + e.getMessage() + "\"}");
        }
    }

    private List<Map<String, Object>> scanAll(String tableName) {
        ScanResponse response = dynamoDbClient.scan(ScanRequest.builder()
                .tableName(tableName)
                .build());

        List<Map<String, Object>> items = new ArrayList<>();
        for (Map<String, AttributeValue> item : response.items()) {
            items.add(DynamoItemConverter.toJavaMap(item));
        }
        return items;
    }

    private Map<String, Object> queryLatestWorkList() {
        QueryResponse response = dynamoDbClient.query(QueryRequest.builder()
                .tableName(workListTable)
                .keyConditionExpression("depotId = :depotId")
                .expressionAttributeValues(Map.of(":depotId", AttributeValue.builder().s(DEPOT_ID).build()))
                .scanIndexForward(false)
                .limit(1)
                .build());

        if (response.items().isEmpty()) {
            return null;
        }
        return DynamoItemConverter.toJavaMap(response.items().get(0));
    }
}
