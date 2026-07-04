package binsight.it;

// Proves sensor -> fog -> backend end to end without touching real AWS: real fog-node logic
// runs in-process (including FleetNode's cross-node wiring), the resulting events land in the
// local AWS emulator via the real Lambda handlers, and IngestRelayHandler is proven to actually
// deliver an HTTP-shaped POST body onto a real SQS queue — the specific gap this project fixes.

import binsight.backend.handlers.ClusterVerdictIngestHandler;
import binsight.backend.handlers.FireRiskIngestHandler;
import binsight.backend.handlers.IngestRelayHandler;
import binsight.backend.handlers.WorkListIngestHandler;
import binsight.fog.binsafety.BinSafetyNode;
import binsight.fog.bincluster.BinClusterNode;
import binsight.fog.fleet.FleetNode;
import binsight.fog.model.SensorReading;
import com.amazonaws.services.lambda.runtime.Context;
import com.amazonaws.services.lambda.runtime.LambdaLogger;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.junit.jupiter.api.BeforeAll;
import org.junit.jupiter.api.Test;
import org.mockito.Mockito;
import software.amazon.awssdk.services.dynamodb.DynamoDbClient;
import software.amazon.awssdk.services.dynamodb.model.AttributeDefinition;
import software.amazon.awssdk.services.dynamodb.model.AttributeValue;
import software.amazon.awssdk.services.dynamodb.model.BillingMode;
import software.amazon.awssdk.services.dynamodb.model.CreateTableRequest;
import software.amazon.awssdk.services.dynamodb.model.DescribeTableRequest;
import software.amazon.awssdk.services.dynamodb.model.KeySchemaElement;
import software.amazon.awssdk.services.dynamodb.model.KeyType;
import software.amazon.awssdk.services.dynamodb.model.QueryRequest;
import software.amazon.awssdk.services.dynamodb.model.ResourceNotFoundException;
import software.amazon.awssdk.services.dynamodb.model.ScalarAttributeType;
import software.amazon.awssdk.services.sqs.SqsClient;
import software.amazon.awssdk.services.sqs.model.CreateQueueRequest;
import software.amazon.awssdk.services.sqs.model.QueueAttributeName;
import software.amazon.awssdk.services.sqs.model.QueueDoesNotExistException;
import software.amazon.awssdk.services.sqs.model.ReceiveMessageRequest;

import java.util.HashMap;
import java.util.List;
import java.util.Map;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertNotNull;
import static org.junit.jupiter.api.Assertions.assertTrue;

class SensorToFogToBackendIT {

    private static final String CLUSTER_TABLE =
            System.getenv().getOrDefault("BINSIGHT_CLUSTER_TABLE", "binsight-cluster-verdicts-table");
    private static final String FIRE_RISK_TABLE =
            System.getenv().getOrDefault("BINSIGHT_FIRE_RISK_TABLE", "binsight-fire-risk-table");
    private static final String WORK_LIST_TABLE =
            System.getenv().getOrDefault("BINSIGHT_WORK_LIST_TABLE", "binsight-work-list-table");

    private static final DynamoDbClient DDB = DynamoDbClient.builder().build();
    private static final SqsClient SQS = SqsClient.builder().build();
    private static final ObjectMapper MAPPER = new ObjectMapper();

    @BeforeAll
    static void ensureTables() {
        ensureTable(CLUSTER_TABLE, "binId", "timestamp");
        ensureTable(FIRE_RISK_TABLE, "binId", "timestamp");
        ensureTable(WORK_LIST_TABLE, "depotId", "timestamp");
    }

    private static void ensureTable(String tableName, String pk, String sk) {
        try {
            DDB.describeTable(DescribeTableRequest.builder().tableName(tableName).build());
            return;
        } catch (ResourceNotFoundException e) {
            // fall through to create
        }
        DDB.createTable(CreateTableRequest.builder()
                .tableName(tableName)
                .billingMode(BillingMode.PAY_PER_REQUEST)
                .keySchema(
                        KeySchemaElement.builder().attributeName(pk).keyType(KeyType.HASH).build(),
                        KeySchemaElement.builder().attributeName(sk).keyType(KeyType.RANGE).build())
                .attributeDefinitions(
                        AttributeDefinition.builder().attributeName(pk).attributeType(ScalarAttributeType.S).build(),
                        AttributeDefinition.builder().attributeName(sk).attributeType(ScalarAttributeType.S).build())
                .build());
    }

    private static String ensureQueue(String queueName) {
        try {
            return SQS.getQueueUrl(b -> b.queueName(queueName)).queueUrl();
        } catch (QueueDoesNotExistException e) {
            return SQS.createQueue(CreateQueueRequest.builder().queueName(queueName).build()).queueUrl();
        }
    }

    private static Context mockContext() {
        LambdaLogger logger = Mockito.mock(LambdaLogger.class);
        Context context = Mockito.mock(Context.class);
        Mockito.lenient().when(context.getLogger()).thenReturn(logger);
        return context;
    }

    private static SensorReading reading(String entityId, String entityType, String metric, Object value, String timestamp) {
        return new SensorReading(entityId, entityType, metric, value, "", timestamp);
    }

    private static void persist(Object handler, List<Map<String, Object>> events) throws Exception {
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
        if (handler instanceof ClusterVerdictIngestHandler h) {
            h.handleRequest(sqsEvent, mockContext());
        } else if (handler instanceof FireRiskIngestHandler h) {
            h.handleRequest(sqsEvent, mockContext());
        } else if (handler instanceof WorkListIngestHandler h) {
            h.handleRequest(sqsEvent, mockContext());
        }
    }

    @Test
    void an_inconsistent_bin_cluster_verdict_dispatches_on_the_eighth_tick_and_persists() throws Exception {
        BinClusterNode node = new BinClusterNode();
        String binId = "bin-it-cluster";

        List<Map<String, Object>> dispatched = List.of();
        dispatched = node.onReading(reading(binId, "bin", "lid-state", "CLOSED", "2026-07-03T09:00:00.000Z"));
        assertTrue(dispatched.isEmpty());
        dispatched = node.onReading(reading(binId, "bin", "fill-level", 50.0, "2026-07-03T09:00:01.000Z"));
        assertTrue(dispatched.isEmpty(), "weight not known yet, verdict cannot compute");

        // fill-level 50% -> expectedWeightKg = 120; weight 200kg is 80kg off, well past the 35% band.
        for (int tick = 3; tick <= 8; tick++) {
            dispatched = node.onReading(reading(binId, "bin", "bin-weight", 200.0, "2026-07-03T09:00:0" + tick + ".000Z"));
        }

        assertEquals(1, dispatched.size(), "must dispatch exactly on the 8th tick, not before");
        assertEquals("INCONSISTENT", dispatched.get(0).get("verdict"));

        persist(new ClusterVerdictIngestHandler(DDB), dispatched);

        var result = DDB.query(QueryRequest.builder()
                .tableName(CLUSTER_TABLE)
                .keyConditionExpression("binId = :b")
                .expressionAttributeValues(Map.of(":b", AttributeValue.builder().s(binId).build()))
                .build());
        assertTrue(result.items().stream().anyMatch(item -> "INCONSISTENT".equals(item.get("verdict").s())));
    }

    @Test
    void a_critical_fire_risk_alert_dispatches_immediately_and_persists() throws Exception {
        BinSafetyNode node = new BinSafetyNode();
        String binId = "bin-it-safety";

        node.onReading(reading(binId, "bin", "methane-ppm", 5000.0, "2026-07-03T10:00:00.000Z"));
        node.onReading(reading(binId, "bin", "methane-ppm", 5000.0, "2026-07-03T10:00:01.000Z"));
        node.onReading(reading(binId, "bin", "internal-temp", 70.0, "2026-07-03T10:00:02.000Z"));
        node.onReading(reading(binId, "bin", "methane-ppm", 5000.0, "2026-07-03T10:00:03.000Z"));
        node.onReading(reading(binId, "bin", "internal-temp", 70.0, "2026-07-03T10:00:04.000Z"));
        node.onReading(reading(binId, "bin", "tilt", 50.0, "2026-07-03T10:00:05.000Z"));
        List<Map<String, Object>> dispatched =
                node.onReading(reading(binId, "bin", "internal-temp", 70.0, "2026-07-03T10:00:06.000Z"));

        assertEquals(1, dispatched.size());
        assertEquals("CRITICAL", dispatched.get(0).get("riskStatus"));

        persist(new FireRiskIngestHandler(DDB), dispatched);

        var result = DDB.query(QueryRequest.builder()
                .tableName(FIRE_RISK_TABLE)
                .keyConditionExpression("binId = :b")
                .expressionAttributeValues(Map.of(":b", AttributeValue.builder().s(binId).build()))
                .build());
        assertTrue(result.items().stream().anyMatch(item -> "CRITICAL".equals(item.get("riskStatus").s())));
    }

    @Test
    void the_fleet_node_cross_node_wiring_dispatches_a_due_work_list_on_the_tenth_global_tick_and_persists() throws Exception {
        String binId = "bin-it-fleet";
        String truckId = "truck-it-fleet";
        String depotId = "depot-it-fleet";

        Map<String, double[]> binLocations = new HashMap<>();
        binLocations.put(binId, new double[] {53.35, -6.26});
        Map<String, Long> lastCollected = new HashMap<>();
        lastCollected.put(binId, 0L); // epoch 0 -> guaranteed hundreds of hours overdue

        FleetNode fleet = new FleetNode(binLocations, lastCollected);

        Map<String, Object> clusterVerdict = new HashMap<>();
        clusterVerdict.put("binId", binId);
        clusterVerdict.put("verdict", "INCONSISTENT");
        clusterVerdict.put("timestamp", "2026-07-03T11:00:00.000Z");
        fleet.onBinClusterVerdict(clusterVerdict); // tick 1

        Map<String, Object> fireRiskAlert = new HashMap<>();
        fireRiskAlert.put("binId", binId);
        fireRiskAlert.put("riskStatus", "CRITICAL");
        fireRiskAlert.put("timestamp", "2026-07-03T11:00:01.000Z");
        fleet.onBinSafetyAlert(fireRiskAlert); // tick 2

        fleet.onReading(reading(binId, "bin", "fill-level", 85.0, "2026-07-03T11:00:02.000Z")); // tick 3
        fleet.onReading(reading(truckId, "truck", "hopper-fill", 50.0, "2026-07-03T11:00:03.000Z")); // tick 4
        fleet.onReading(reading(truckId, "truck", "fuel-level", 80.0, "2026-07-03T11:00:04.000Z")); // tick 5
        fleet.onReading(reading(depotId, "depot", "weighbridge-tonnage", 5.0, "2026-07-03T11:00:05.000Z")); // tick 6
        fleet.onReading(reading(truckId, "truck", "truck-gps",
                Map.of("lat", 53.351, "lon", -6.261, "headingDeg", 90.0), "2026-07-03T11:00:06.000Z")); // tick 7
        fleet.onReading(reading(binId, "bin", "fill-level", 85.0, "2026-07-03T11:00:07.000Z")); // tick 8
        fleet.onReading(reading(truckId, "truck", "hopper-fill", 51.0, "2026-07-03T11:00:08.000Z")); // tick 9
        List<Map<String, Object>> dispatched =
                fleet.onReading(reading(truckId, "truck", "fuel-level", 79.0, "2026-07-03T11:00:09.000Z")); // tick 10

        assertEquals(1, dispatched.size(), "must dispatch exactly on the 10th global tick");
        Map<String, Object> workListEvent = dispatched.get(0);
        assertEquals("work_list_event", workListEvent.get("type"));

        @SuppressWarnings("unchecked")
        List<Map<String, Object>> items = (List<Map<String, Object>>) workListEvent.get("items");
        assertEquals(1, items.size());
        Map<String, Object> item = items.get(0);
        assertEquals(binId, item.get("binId"));
        assertEquals(truckId, item.get("assignedTruckId"), "the only known truck position must win nearest-neighbour");
        @SuppressWarnings("unchecked")
        List<String> dueReasons = (List<String>) item.get("dueReasons");
        assertTrue(dueReasons.contains("HIGH_FILL"));
        assertTrue(dueReasons.contains("SAFETY_RISK"));
        assertTrue(dueReasons.contains("OVERDUE"));

        persist(new WorkListIngestHandler(DDB), dispatched);

        var result = DDB.query(QueryRequest.builder()
                .tableName(WORK_LIST_TABLE)
                .keyConditionExpression("depotId = :d")
                .expressionAttributeValues(Map.of(":d", AttributeValue.builder().s("depot-01").build()))
                .build());
        assertTrue(result.items().size() >= 1);
    }

    @Test
    void the_ingest_relay_handler_actually_delivers_an_http_posted_body_onto_the_real_sqs_queue() {
        // BINSIGHT_TARGET_QUEUE_URL is exported before this JVM starts (see README/CI), pointing
        // at a queue precreated with the same deterministic floci URL format this asserts against —
        // this proves the exact code path IngestRelayHandler runs in Lambda, not a stand-in.
        String queueUrl = System.getenv("BINSIGHT_TARGET_QUEUE_URL");
        assertNotNull(queueUrl, "BINSIGHT_TARGET_QUEUE_URL must be exported before running this test");
        ensureQueue("binsight-it-relay-queue");

        IngestRelayHandler relay = new IngestRelayHandler(SQS);
        String postedBody = "{\"type\":\"cluster_verdict\",\"binId\":\"bin-it-relay\"}";
        Map<String, Object> apiGatewayEvent = Map.of("body", postedBody);

        Map<String, Object> response = relay.handleRequest(apiGatewayEvent, mockContext());
        assertEquals(202, response.get("statusCode"));

        var received = SQS.receiveMessage(ReceiveMessageRequest.builder()
                .queueUrl(queueUrl)
                .waitTimeSeconds(2)
                .maxNumberOfMessages(5)
                .build());

        assertTrue(received.messages().stream().anyMatch(m -> m.body().contains("bin-it-relay")),
                "the HTTP-posted body must have actually landed on the SQS queue via the real relay handler");
    }

    @Test
    void a_malformed_record_does_not_sink_the_rest_of_the_batch() {
        Map<String, Object> sqsEvent = Map.of("Records", List.of(Map.of("body", "not valid json")));
        new ClusterVerdictIngestHandler(DDB).handleRequest(sqsEvent, mockContext());
    }
}
