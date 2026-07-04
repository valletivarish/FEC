package edu.msc.chainfrost.backend.ingest;

import edu.msc.chainfrost.fog.common.FogEvent;
import software.amazon.awssdk.services.dynamodb.DynamoDbClient;
import software.amazon.awssdk.services.dynamodb.model.AttributeValue;
import software.amazon.awssdk.services.dynamodb.model.PutItemRequest;
import software.amazon.awssdk.services.dynamodb.model.UpdateItemRequest;

import java.time.Instant;
import java.util.HashMap;
import java.util.Map;

/**
 * Translates FogEvent records into the three DynamoDB item shapes the
 * fleet API reads back from. Table names come from env vars so the same
 * jar runs unmodified against CDK-provisioned or local tables.
 */
public class DynamoWriter {

    private final DynamoDbClient dynamoDbClient;
    private final String zoneTempTable;
    private final String shipmentsTable;
    private final String faultsTable;

    public DynamoWriter(DynamoDbClient dynamoDbClient) {
        this(dynamoDbClient,
                System.getenv("CHAINFROST_ZONE_TEMP_TABLE"),
                System.getenv("CHAINFROST_SHIPMENTS_TABLE"),
                System.getenv("CHAINFROST_FAULTS_TABLE"));
    }

    public DynamoWriter(DynamoDbClient dynamoDbClient, String zoneTempTable,
                         String shipmentsTable, String faultsTable) {
        this.dynamoDbClient = dynamoDbClient;
        this.zoneTempTable = zoneTempTable;
        this.shipmentsTable = shipmentsTable;
        this.faultsTable = faultsTable;
    }

    /**
     * Zone temperature excursion samples are keyed by zone#timestamp so a
     * truck's history for either zone can be queried in timestamp order.
     */
    public void writeZoneTempSample(FogEvent event) {
        String zone = String.valueOf(event.payload().getOrDefault("zone", "zone1"));
        String value = String.valueOf(event.payload().getOrDefault("value", "0"));
        String sortKey = zone + "#" + event.timestamp().toString();

        Map<String, AttributeValue> item = new HashMap<>();
        item.put("truckId", AttributeValue.builder().s(event.truckId()).build());
        item.put("zoneTimestamp", AttributeValue.builder().s(sortKey).build());
        item.put("zone", AttributeValue.builder().s(zone).build());
        item.put("value", AttributeValue.builder().n(value).build());
        item.put("eventType", AttributeValue.builder().s(event.eventType()).build());
        item.put("severity", AttributeValue.builder().s(event.severity()).build());
        item.put("shipmentId", AttributeValue.builder().s(event.shipmentId()).build());
        item.put("timestamp", AttributeValue.builder().s(event.timestamp().toString()).build());

        dynamoDbClient.putItem(PutItemRequest.builder()
                .tableName(zoneTempTable)
                .item(item)
                .build());
    }

    /**
     * Upserts the rolling shipment status row via UpdateItem (not PutItem) so an excursion
     * on one zone doesn't wipe the other zone's temp or the humidity/position fields set by
     * other event types. TempFogNode reports one zone per event under "zone"/"currentTempCelsius",
     * so the reading is fanned into the matching zone1/zone2 column rather than both.
     */
    public void upsertShipmentStatus(FogEvent event) {
        String zone = String.valueOf(event.payload().getOrDefault("zone", "zone1"));
        String zoneTempField = "zone2".equals(zone) ? "latestZone2Temp" : "latestZone1Temp";

        Map<String, AttributeValue> key = Map.of("shipmentId", AttributeValue.builder().s(event.shipmentId()).build());
        Map<String, AttributeValue> values = new HashMap<>();
        values.put(":truckId", AttributeValue.builder().s(event.truckId()).build());
        values.put(":complianceStatus", AttributeValue.builder().s(severityToStatus(event.severity())).build());
        values.put(":lastUpdated", AttributeValue.builder().s(event.timestamp().toString()).build());
        values.put(":lastEventType", AttributeValue.builder().s(event.eventType()).build());

        StringBuilder updateExpression = new StringBuilder(
                "SET truckId = :truckId, complianceStatus = :complianceStatus, "
                        + "lastUpdated = :lastUpdated, lastEventType = :lastEventType");

        Object currentTemp = event.payload().get("currentTempCelsius");
        if (currentTemp != null) {
            values.put(":zoneTemp", AttributeValue.builder().n(String.valueOf(currentTemp)).build());
            updateExpression.append(", ").append(zoneTempField).append(" = :zoneTemp");
        }
        Object setpoint = event.payload().get("setpointCelsius");
        if (setpoint != null) {
            values.put(":setpointC", AttributeValue.builder().n(String.valueOf(setpoint)).build());
            updateExpression.append(", setpointC = :setpointC");
        }
        Object mkt = event.payload().get("meanKineticTempCelsius");
        if (mkt != null) {
            values.put(":latestMkt", AttributeValue.builder().n(String.valueOf(mkt)).build());
            updateExpression.append(", latestMkt = :latestMkt");
        }

        dynamoDbClient.updateItem(UpdateItemRequest.builder()
                .tableName(shipmentsTable)
                .key(key)
                .updateExpression(updateExpression.toString())
                .expressionAttributeValues(values)
                .build());
    }

    /**
     * Records last-known GPS/telematics state on the shipment row via UpdateItem (not PutItem)
     * so a telematics event doesn't wipe the compliance/temp/humidity fields set by the most
     * recent excursion or reefer-status event, mirroring upsertShipmentStatus/upsertShipmentHumidity.
     */
    public void upsertShipmentPosition(FogEvent event) {
        Map<String, AttributeValue> key = Map.of("shipmentId", AttributeValue.builder().s(event.shipmentId()).build());
        Map<String, AttributeValue> values = new HashMap<>();
        values.put(":truckId", AttributeValue.builder().s(event.truckId()).build());
        values.put(":lastUpdated", AttributeValue.builder().s(event.timestamp().toString()).build());
        values.put(":lastEventType", AttributeValue.builder().s(event.eventType()).build());

        StringBuilder updateExpression = new StringBuilder(
                "SET truckId = :truckId, lastUpdated = :lastUpdated, lastEventType = :lastEventType");

        appendIfPresent(updateExpression, values, "lastLat", "lat", event);
        appendIfPresent(updateExpression, values, "lastLon", "lon", event);
        appendIfPresent(updateExpression, values, "lastSpeed", "speed", event);
        appendIfPresent(updateExpression, values, "lastShock", "shock", event);

        dynamoDbClient.updateItem(UpdateItemRequest.builder()
                .tableName(shipmentsTable)
                .key(key)
                .updateExpression(updateExpression.toString())
                .expressionAttributeValues(values)
                .build());
    }

    /**
     * REEFER_STATUS carries only a humidity refresh, so this uses UpdateItem rather than the
     * full-row PutItem the other upserts use - a plain Put here would wipe compliance/temp
     * fields set by the most recent excursion event.
     */
    public void upsertShipmentHumidity(FogEvent event) {
        Object humidityPct = event.payload().get("humidityPct");
        if (humidityPct == null) {
            return;
        }
        Map<String, AttributeValue> key = Map.of("shipmentId", AttributeValue.builder().s(event.shipmentId()).build());
        Map<String, AttributeValue> values = new HashMap<>();
        values.put(":truckId", AttributeValue.builder().s(event.truckId()).build());
        values.put(":humidityPct", AttributeValue.builder().n(String.valueOf(humidityPct)).build());
        values.put(":lastUpdated", AttributeValue.builder().s(event.timestamp().toString()).build());

        dynamoDbClient.updateItem(UpdateItemRequest.builder()
                .tableName(shipmentsTable)
                .key(key)
                .updateExpression("SET truckId = :truckId, humidityPct = :humidityPct, lastUpdated = :lastUpdated")
                .expressionAttributeValues(values)
                .build());
    }

    public void writeFaultEvent(FogEvent event) {
        Map<String, AttributeValue> item = new HashMap<>();
        item.put("truckId", AttributeValue.builder().s(event.truckId()).build());
        item.put("eventTimestamp", AttributeValue.builder().s(event.timestamp().toString()).build());
        item.put("shipmentId", AttributeValue.builder().s(event.shipmentId()).build());
        item.put("eventType", AttributeValue.builder().s(event.eventType()).build());
        item.put("severity", AttributeValue.builder().s(event.severity()).build());

        for (Map.Entry<String, Object> entry : event.payload().entrySet()) {
            item.put("payload_" + entry.getKey(),
                    AttributeValue.builder().s(String.valueOf(entry.getValue())).build());
        }

        dynamoDbClient.putItem(PutItemRequest.builder()
                .tableName(faultsTable)
                .item(item)
                .build());
    }

    private void appendIfPresent(StringBuilder updateExpression, Map<String, AttributeValue> values,
                                  String attributeName, String payloadKey, FogEvent event) {
        Object value = event.payload().get(payloadKey);
        if (value == null) {
            return;
        }
        String placeholder = ":" + attributeName;
        values.put(placeholder, AttributeValue.builder().n(String.valueOf(value)).build());
        updateExpression.append(", ").append(attributeName).append(" = ").append(placeholder);
    }

    private String severityToStatus(String severity) {
        return switch (severity) {
            case "BREACH" -> "BREACH";
            case "WARN" -> "WARN";
            default -> "OK";
        };
    }

    static String deriveShipmentId(String truckId, Instant instant) {
        return truckId + "-" + instant.toString().substring(0, 10);
    }
}
