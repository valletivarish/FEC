package edu.msc.chainfrost.backend.api;

import com.amazonaws.services.lambda.runtime.Context;
import com.amazonaws.services.lambda.runtime.RequestHandler;
import com.amazonaws.services.lambda.runtime.events.APIGatewayProxyRequestEvent;
import com.amazonaws.services.lambda.runtime.events.APIGatewayProxyResponseEvent;
import edu.msc.chainfrost.backend.util.JsonMapper;
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
 * GET /fleet/health - full table scan over the shipments table so the manifest
 * view gets one row per real shipment. Fine at demo scale; a GSI would be
 * needed to avoid scanning at fleet scale.
 */
public class FleetHealthHandler implements RequestHandler<APIGatewayProxyRequestEvent, APIGatewayProxyResponseEvent> {

    private static final int SPARKLINE_SAMPLE_COUNT = 6;

    private final DynamoDbClient dynamoDbClient;
    private final String shipmentsTable;
    private final String zoneTempTable;

    public FleetHealthHandler() {
        this(DynamoDbClient.create(),
                System.getenv("CHAINFROST_SHIPMENTS_TABLE"),
                System.getenv("CHAINFROST_ZONE_TEMP_TABLE"));
    }

    public FleetHealthHandler(DynamoDbClient dynamoDbClient, String shipmentsTable, String zoneTempTable) {
        this.dynamoDbClient = dynamoDbClient;
        this.shipmentsTable = shipmentsTable;
        this.zoneTempTable = zoneTempTable;
    }

    @Override
    public APIGatewayProxyResponseEvent handleRequest(APIGatewayProxyRequestEvent request, Context context) {
        try {
            ScanResponse response = dynamoDbClient.scan(ScanRequest.builder()
                    .tableName(shipmentsTable)
                    .build());

            List<Map<String, Object>> shipments = new ArrayList<>();
            for (Map<String, AttributeValue> item : response.items()) {
                shipments.add(toManifestEntry(item));
            }

            Map<String, Object> summary = new LinkedHashMap<>();
            summary.put("shipments", shipments);

            return ApiResponses.ok(JsonMapper.INSTANCE.writeValueAsString(summary));
        } catch (Exception e) {
            return ApiResponses.serverError("{\"message\":\"" + e.getMessage() + "\"}");
        }
    }

    /**
     * Maps a raw ChainFrostShipments item onto the manifest row shape the dashboard
     * renders. zoneTempC surfaces zone1 (the primary monitored zone, same as
     * ExcursionHistoryHandler/TempFogNode); zone2 stays queryable via the shipment
     * detail endpoint rather than duplicated here.
     */
    private Map<String, Object> toManifestEntry(Map<String, AttributeValue> item) {
        Map<String, Object> entry = new LinkedHashMap<>();
        entry.put("shipmentId", stringOrNull(item.get("shipmentId")));
        entry.put("truckId", stringOrNull(item.get("truckId")));
        entry.put("complianceStatus", stringOrDefault(item.get("complianceStatus"), "OK"));
        entry.put("zoneTempC", numberOrNull(item.get("latestZone1Temp")));
        entry.put("setpointC", numberOrNull(item.get("setpointC")));

        String truckId = stringOrNull(item.get("truckId"));
        if (truckId != null) {
            List<Double> sparkline = fetchZoneTempSparkline(truckId);
            if (!sparkline.isEmpty()) {
                entry.put("zoneTempSparkline", sparkline);
            }
        }
        return entry;
    }

    /**
     * Pulls the most recent zone1 readings for the truck so the manifest shows a
     * real trend rather than a fabricated one; empty when the truck has no history yet.
     */
    private List<Double> fetchZoneTempSparkline(String truckId) {
        if (zoneTempTable == null) {
            return List.of();
        }
        QueryResponse response = dynamoDbClient.query(QueryRequest.builder()
                .tableName(zoneTempTable)
                .keyConditionExpression("truckId = :truckId AND begins_with(zoneTimestamp, :zonePrefix)")
                .expressionAttributeValues(Map.of(
                        ":truckId", AttributeValue.builder().s(truckId).build(),
                        ":zonePrefix", AttributeValue.builder().s("zone1#").build()))
                .scanIndexForward(true)
                .build());

        List<Double> values = new ArrayList<>();
        for (Map<String, AttributeValue> item : response.items()) {
            AttributeValue value = item.get("value");
            if (value != null && value.n() != null) {
                values.add(Double.valueOf(value.n()));
            }
        }
        if (values.size() <= SPARKLINE_SAMPLE_COUNT) {
            return values;
        }
        return values.subList(values.size() - SPARKLINE_SAMPLE_COUNT, values.size());
    }

    private String stringOrNull(AttributeValue value) {
        return value != null ? value.s() : null;
    }

    private String stringOrDefault(AttributeValue value, String fallback) {
        String s = stringOrNull(value);
        return s != null ? s : fallback;
    }

    private Double numberOrNull(AttributeValue value) {
        return value != null && value.n() != null ? Double.valueOf(value.n()) : null;
    }
}
