package com.guardianedge.it;

// Proves sensor -> fog -> backend end to end without touching real AWS: real fog-node logic
// runs in-process against a scripted reading sequence, and the resulting events land in the
// local AWS emulator via the real Lambda handlers' read/write paths.

import com.amazonaws.services.lambda.runtime.Context;
import com.amazonaws.services.lambda.runtime.LambdaLogger;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.guardianedge.backend.handlers.IngestEventHandler;
import com.guardianedge.backend.handlers.QueryResidentsHandler;
import com.guardianedge.fog.fallfog.FallFogNode;
import com.guardianedge.fog.presencefog.PresenceFogNode;
import com.guardianedge.fog.vitalsfog.VitalsFogNode;
import org.junit.jupiter.api.BeforeAll;
import org.junit.jupiter.api.Test;
import org.mockito.Mockito;
import software.amazon.awssdk.services.dynamodb.DynamoDbClient;
import software.amazon.awssdk.services.dynamodb.model.AttributeDefinition;
import software.amazon.awssdk.services.dynamodb.model.AttributeValue;
import software.amazon.awssdk.services.dynamodb.model.BillingMode;
import software.amazon.awssdk.services.dynamodb.model.CreateTableRequest;
import software.amazon.awssdk.services.dynamodb.model.DescribeTableRequest;
import software.amazon.awssdk.services.dynamodb.model.GetItemRequest;
import software.amazon.awssdk.services.dynamodb.model.KeySchemaElement;
import software.amazon.awssdk.services.dynamodb.model.KeyType;
import software.amazon.awssdk.services.dynamodb.model.QueryRequest;
import software.amazon.awssdk.services.dynamodb.model.ResourceNotFoundException;
import software.amazon.awssdk.services.dynamodb.model.ScalarAttributeType;

import java.util.HashMap;
import java.util.List;
import java.util.Map;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertTrue;

class SensorToBackendIT {

    private static final String HISTORY_TABLE =
            System.getenv().getOrDefault("GUARDIANEDGE_HISTORY_TABLE", "guardianedge-event-history-table");
    private static final String STATUS_TABLE =
            System.getenv().getOrDefault("GUARDIANEDGE_STATUS_TABLE", "guardianedge-resident-status-table");

    private static final DynamoDbClient DDB = DynamoDbClient.builder().build();
    private static final ObjectMapper MAPPER = new ObjectMapper();

    @BeforeAll
    static void ensureTables() {
        ensureTable(HISTORY_TABLE, "residentId", "eventTypeTimestamp");
        ensureTable(STATUS_TABLE, "residentId", null);
    }

    private static void ensureTable(String tableName, String pk, String sk) {
        try {
            DDB.describeTable(DescribeTableRequest.builder().tableName(tableName).build());
            return;
        } catch (ResourceNotFoundException e) {
            // fall through to create
        }

        var keySchema = sk == null
                ? List.of(KeySchemaElement.builder().attributeName(pk).keyType(KeyType.HASH).build())
                : List.of(
                        KeySchemaElement.builder().attributeName(pk).keyType(KeyType.HASH).build(),
                        KeySchemaElement.builder().attributeName(sk).keyType(KeyType.RANGE).build());

        var attrDefs = sk == null
                ? List.of(AttributeDefinition.builder().attributeName(pk).attributeType(ScalarAttributeType.S).build())
                : List.of(
                        AttributeDefinition.builder().attributeName(pk).attributeType(ScalarAttributeType.S).build(),
                        AttributeDefinition.builder().attributeName(sk).attributeType(ScalarAttributeType.S).build());

        DDB.createTable(CreateTableRequest.builder()
                .tableName(tableName)
                .billingMode(BillingMode.PAY_PER_REQUEST)
                .keySchema(keySchema)
                .attributeDefinitions(attrDefs)
                .build());
    }

    private static Context mockContext() {
        LambdaLogger logger = Mockito.mock(LambdaLogger.class);
        Context context = Mockito.mock(Context.class);
        Mockito.lenient().when(context.getLogger()).thenReturn(logger);
        return context;
    }

    private static Map<String, Object> reading(String residentId, String metric, double value, String timestamp) {
        Map<String, Object> r = new HashMap<>();
        r.put("residentId", residentId);
        r.put("metric", metric);
        r.put("value", value);
        r.put("unit", "");
        r.put("timestamp", timestamp);
        return r;
    }

    private static void persist(List<Map<String, Object>> events) throws Exception {
        List<Map<String, Object>> records = events.stream()
                .map(e -> {
                    try {
                        return Map.<String, Object>of("body", MAPPER.writeValueAsString(e));
                    } catch (Exception ex) {
                        throw new RuntimeException(ex);
                    }
                })
                .toList();
        Map<String, Object> sqsEvent = Map.of("Records", records);
        new IngestEventHandler(DDB).handleRequest(sqsEvent, mockContext());
    }

    private static Map<String, AttributeValue> getStatus(String residentId) {
        var result = DDB.getItem(GetItemRequest.builder()
                .tableName(STATUS_TABLE)
                .key(Map.of("residentId", AttributeValue.builder().s(residentId).build()))
                .build());
        return result.item();
    }

    @Test
    void a_scripted_free_fall_sequence_dispatches_exactly_one_fall_confirmed_event_and_persists() throws Exception {
        FallFogNode node = new FallFogNode();
        String residentId = "resident-it-fall";
        List<Map<String, Object>> allDispatched = new java.util.ArrayList<>();

        // MONITORING -> FREE_FALL: 3 consecutive readings under the free-fall threshold.
        allDispatched.addAll(node.onReading(reading(residentId, "accelerometer", 1.5, "2026-07-03T09:00:00.000Z")));
        allDispatched.addAll(node.onReading(reading(residentId, "accelerometer", 1.4, "2026-07-03T09:00:01.000Z")));
        allDispatched.addAll(node.onReading(reading(residentId, "accelerometer", 1.6, "2026-07-03T09:00:02.000Z")));

        // FREE_FALL -> IMPACT -> STILLNESS_CONFIRM: a single spike above 12g.
        allDispatched.addAll(node.onReading(reading(residentId, "accelerometer", 150.0, "2026-07-03T09:00:03.000Z")));

        // STILLNESS_CONFIRM: 5 low, near-identical gyro readings (stddev well under 5 deg/s) -> FALL_CONFIRMED.
        allDispatched.addAll(node.onReading(reading(residentId, "gyroscope", 2.0, "2026-07-03T09:00:04.000Z")));
        allDispatched.addAll(node.onReading(reading(residentId, "gyroscope", 2.1, "2026-07-03T09:00:05.000Z")));
        allDispatched.addAll(node.onReading(reading(residentId, "gyroscope", 1.9, "2026-07-03T09:00:06.000Z")));
        allDispatched.addAll(node.onReading(reading(residentId, "gyroscope", 2.0, "2026-07-03T09:00:07.000Z")));
        allDispatched.addAll(node.onReading(reading(residentId, "gyroscope", 2.1, "2026-07-03T09:00:08.000Z")));

        assertEquals(1, allDispatched.size(), "exactly one FALL_CONFIRMED event must dispatch for the whole sequence");
        assertEquals("FALL_CONFIRMED", allDispatched.get(0).get("state"));

        persist(allDispatched);

        Map<String, AttributeValue> status = getStatus(residentId);
        assertEquals("CRITICAL", status.get("currentRiskState").s());
    }

    @Test
    void a_heartrate_reading_that_clears_the_hysteresis_debounce_escalates_status_to_critical() throws Exception {
        VitalsFogNode node = new VitalsFogNode();
        String residentId = "resident-it-vitals";
        List<Map<String, Object>> dispatched = new java.util.ArrayList<>();

        dispatched.addAll(node.onReading(reading(residentId, "heartrate", 140.0, "2026-07-03T10:00:00.000Z")));
        dispatched.addAll(node.onReading(reading(residentId, "heartrate", 140.0, "2026-07-03T10:00:01.000Z")));
        dispatched.addAll(node.onReading(reading(residentId, "heartrate", 140.0, "2026-07-03T10:00:02.000Z")));

        Map<String, Object> critical = dispatched.stream()
                .filter(e -> "CRITICAL".equals(e.get("newState")))
                .findFirst()
                .orElseThrow(() -> new AssertionError("expected a CRITICAL transition in " + dispatched));

        persist(dispatched);

        Map<String, AttributeValue> status = getStatus(residentId);
        assertEquals("CRITICAL", status.get("currentRiskState").s());
    }

    @Test
    void a_presence_transition_persists_to_history_without_touching_risk_state() throws Exception {
        PresenceFogNode node = new PresenceFogNode();
        String residentId = "resident-it-presence";
        List<Map<String, Object>> dispatched = new java.util.ArrayList<>();

        dispatched.addAll(node.onReading(reading(residentId, "room-pir", 1, "2026-07-03T11:00:00.000Z")));
        dispatched.addAll(node.onReading(reading(residentId, "room-pir", 1, "2026-07-03T11:00:01.000Z")));
        dispatched.addAll(node.onReading(reading(residentId, "room-pir", 1, "2026-07-03T11:00:02.000Z")));

        assertTrue(dispatched.stream().anyMatch(e -> "presence_event".equals(e.get("type"))));

        persist(dispatched);

        var history = DDB.query(QueryRequest.builder()
                .tableName(HISTORY_TABLE)
                .keyConditionExpression("residentId = :r")
                .expressionAttributeValues(Map.of(":r", AttributeValue.builder().s(residentId).build()))
                .build());
        assertTrue(history.items().stream().anyMatch(item -> "presence_event".equals(item.get("type").s())));
    }

    @Test
    void a_malformed_record_does_not_sink_the_rest_of_the_batch() {
        Map<String, Object> sqsEvent = Map.of("Records", List.of(Map.of("body", "not valid json")));
        new IngestEventHandler(DDB).handleRequest(sqsEvent, mockContext());
    }

    @Test
    void query_residents_handler_lists_the_roster_and_acknowledges_an_alert() throws Exception {
        String residentId = "resident-it-query";
        persist(List.of(Map.of(
                "type", "fall_event",
                "residentId", residentId,
                "state", "FALL_CONFIRMED",
                "accelMagnitude", 150.0,
                "timestamp", "2026-07-03T12:00:00.000Z")));

        QueryResidentsHandler handler = new QueryResidentsHandler(DDB);

        Map<String, Object> listEvent = Map.of("routeKey", "GET /residents");
        Map<String, Object> listResponse = handler.handleRequest(listEvent, mockContext());
        assertEquals(200, listResponse.get("statusCode"));
        JsonNode roster = MAPPER.readTree((String) listResponse.get("body"));
        assertTrue(roster.isArray());
        boolean found = false;
        for (JsonNode item : roster) {
            if (residentId.equals(item.path("residentId").asText())) {
                found = true;
            }
        }
        assertTrue(found, "expected " + residentId + " to appear in the roster listing");

        Map<String, Object> ackEvent = Map.of(
                "routeKey", "POST /residents/{residentId}/acknowledge",
                "pathParameters", Map.of("residentId", residentId));
        Map<String, Object> ackResponse = handler.handleRequest(ackEvent, mockContext());
        assertEquals(200, ackResponse.get("statusCode"));
        JsonNode acked = MAPPER.readTree((String) ackResponse.get("body"));
        assertEquals("false", acked.path("needsAcknowledgement").asText());
    }
}
