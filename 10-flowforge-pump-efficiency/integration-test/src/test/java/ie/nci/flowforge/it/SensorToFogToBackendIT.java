package ie.nci.flowforge.it;

import com.amazonaws.services.lambda.runtime.Context;
import com.amazonaws.services.lambda.runtime.LambdaLogger;
import com.fasterxml.jackson.databind.ObjectMapper;
import ie.nci.flowforge.backend.handlers.IngestEventHandler;
import ie.nci.flowforge.backend.handlers.InsightRelayHandler;
import ie.nci.flowforge.fn1health.HealthNode;
import ie.nci.flowforge.fn2hydraulics.HydraulicsNode;
import ie.nci.flowforge.fn3integrity.IntegrityNode;
import org.junit.jupiter.api.BeforeAll;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.mockito.Mockito;
import software.amazon.awssdk.services.dynamodb.DynamoDbClient;
import software.amazon.awssdk.services.dynamodb.model.AttributeDefinition;
import software.amazon.awssdk.services.dynamodb.model.AttributeValue;
import software.amazon.awssdk.services.dynamodb.model.BillingMode;
import software.amazon.awssdk.services.dynamodb.model.CreateTableRequest;
import software.amazon.awssdk.services.dynamodb.model.KeySchemaElement;
import software.amazon.awssdk.services.dynamodb.model.KeyType;
import software.amazon.awssdk.services.dynamodb.model.QueryRequest;
import software.amazon.awssdk.services.dynamodb.model.QueryResponse;
import software.amazon.awssdk.services.dynamodb.model.ResourceInUseException;
import software.amazon.awssdk.services.dynamodb.model.ScalarAttributeType;
import software.amazon.awssdk.services.sqs.SqsClient;
import software.amazon.awssdk.services.sqs.model.CreateQueueRequest;
import software.amazon.awssdk.services.sqs.model.QueueDoesNotExistException;
import software.amazon.awssdk.services.sqs.model.ReceiveMessageRequest;

import java.util.HashMap;
import java.util.List;
import java.util.Map;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertNotNull;
import static org.junit.jupiter.api.Assertions.assertTrue;

/**
 * Proves sensor -> fog -> backend end to end without touching real AWS: real fog-node logic
 * runs in-process against a scripted fixture, and events land in the local AWS emulator via
 * the real IngestEventHandler write path.
 */
class SensorToFogToBackendIT {

    private static final String TABLE = System.getenv().getOrDefault("FLOWFORGE_INSIGHTS_TABLE", "flowforge-insights-table");
    private static final ObjectMapper MAPPER = new ObjectMapper();
    private static final SqsClient SQS = SqsClient.builder().build();

    private static DynamoDbClient dynamoDbClient;
    private IngestEventHandler handler;
    private Context context;

    private static String ensureQueue(String queueName) {
        try {
            return SQS.getQueueUrl(b -> b.queueName(queueName)).queueUrl();
        } catch (QueueDoesNotExistException e) {
            return SQS.createQueue(CreateQueueRequest.builder().queueName(queueName).build()).queueUrl();
        }
    }

    @BeforeAll
    static void ensureTable() {
        dynamoDbClient = DynamoDbClient.builder().build();
        try {
            dynamoDbClient.createTable(CreateTableRequest.builder()
                    .tableName(TABLE)
                    .billingMode(BillingMode.PAY_PER_REQUEST)
                    .attributeDefinitions(
                            AttributeDefinition.builder().attributeName("pumpId").attributeType(ScalarAttributeType.S).build(),
                            AttributeDefinition.builder().attributeName("eventTypeTimestamp").attributeType(ScalarAttributeType.S).build())
                    .keySchema(
                            KeySchemaElement.builder().attributeName("pumpId").keyType(KeyType.HASH).build(),
                            KeySchemaElement.builder().attributeName("eventTypeTimestamp").keyType(KeyType.RANGE).build())
                    .build());
        } catch (ResourceInUseException alreadyExists) {
            // fine, a previous run already created it
        }
    }

    @BeforeEach
    void setUp() {
        LambdaLogger logger = Mockito.mock(LambdaLogger.class);
        context = Mockito.mock(Context.class);
        Mockito.lenient().when(context.getLogger()).thenReturn(logger);
        handler = new IngestEventHandler(dynamoDbClient);
    }

    private void persist(Map<String, Object> event) throws Exception {
        String body = MAPPER.writeValueAsString(event);
        Map<String, Object> sqsEvent = Map.of("Records", List.of(Map.of("body", body)));
        handler.handleRequest(sqsEvent, context);
    }

    private List<Map<String, AttributeValue>> queryPump(String pumpId) {
        QueryResponse response = dynamoDbClient.query(QueryRequest.builder()
                .tableName(TABLE)
                .keyConditionExpression("pumpId = :p")
                .expressionAttributeValues(Map.of(":p", AttributeValue.builder().s(pumpId).build()))
                .build());
        return response.items();
    }

    @Test
    void aVibrationSpikeAgainstANoisyBaselineTripsAMadAnomalyAndPersists() throws Exception {
        HealthNode node = new HealthNode();
        String pumpId = "pump-it-health";

        double[] baseline = {3.0, 3.1, 2.9, 3.05, 2.95, 3.02, 2.98, 3.03, 2.97, 3.01};
        List<Map<String, Object>> dispatched = new java.util.ArrayList<>();
        for (int i = 0; i < baseline.length; i++) {
            dispatched.addAll(node.onReading(reading(pumpId, "vibration", baseline[i], "2026-07-03T09:00:0" + i + ".000Z")));
        }
        // tick 6 of 10 always fires a heartbeat regardless of MAD/CUSUM state -- a settled
        // baseline must produce ONLY that heartbeat, never a genuine anomaly/changepoint trigger.
        assertTrue(dispatched.stream().noneMatch(e -> "mad_anomaly".equals(e.get("trigger")) || "cusum_changepoint".equals(e.get("trigger"))),
                "a settled noisy baseline must not trip mad_anomaly or cusum_changepoint");

        List<Map<String, Object>> spikeEvents = node.onReading(reading(pumpId, "vibration", 9.0, "2026-07-03T09:00:10.000Z"));
        assertEquals(1, spikeEvents.size());
        assertEquals("mad_anomaly", spikeEvents.get(0).get("trigger"));

        persist(spikeEvents.get(0));

        List<Map<String, AttributeValue>> items = queryPump(pumpId);
        assertTrue(items.stream().anyMatch(item -> "mad_anomaly".equals(item.get("trigger").s())));
    }

    @Test
    void aSustainedEfficiencyDeviationDebouncesToAWarningAfterThreeCyclesAndPersists() throws Exception {
        HydraulicsNode node = new HydraulicsNode();
        String pumpId = "pump-it-hydraulics";

        node.onReading(reading(pumpId, "inlet-pressure", 1.0, "2026-07-03T10:00:00.000Z"));
        node.onReading(reading(pumpId, "flow-rate", 100.0, "2026-07-03T10:00:00.000Z"));
        node.onReading(reading(pumpId, "power-draw", 6.1745, "2026-07-03T10:00:00.000Z"));
        node.onReading(reading(pumpId, "rpm", 1500.0, "2026-07-03T10:00:00.000Z"));

        List<Map<String, Object>> first = node.onReading(reading(pumpId, "outlet-pressure", 2.0, "2026-07-03T10:00:01.000Z"));
        List<Map<String, Object>> second = node.onReading(reading(pumpId, "outlet-pressure", 2.0, "2026-07-03T10:00:02.000Z"));
        assertTrue(first.isEmpty(), "1 breach alone must not dispatch");
        assertTrue(second.isEmpty(), "2 breaches alone must not dispatch");

        List<Map<String, Object>> third = node.onReading(reading(pumpId, "outlet-pressure", 2.0, "2026-07-03T10:00:03.000Z"));
        assertEquals(1, third.size());
        assertEquals("WARNING", third.get(0).get("severity"));

        persist(third.get(0));

        List<Map<String, AttributeValue>> items = queryPump(pumpId);
        assertTrue(items.stream().anyMatch(item -> "WARNING".equals(item.get("severity").s())));
    }

    @Test
    void aSealLeakEscalatesFromWatchToCriticalOnATrendAndBothTransitionsPersist() throws Exception {
        IntegrityNode node = new IntegrityNode();
        String pumpId = "pump-it-integrity";

        List<Map<String, Object>> watchEvents = node.onReading(reading(pumpId, "seal-leak", 35.0, "2026-07-03T11:00:00.000Z"));
        assertEquals(1, watchEvents.size());
        assertEquals("LEAK_WATCH", watchEvents.get(0).get("state"));
        persist(watchEvents.get(0));

        double[] risingLeak = {36.0, 38.0, 40.0, 42.0, 45.0};
        List<Map<String, Object>> critical = List.of();
        for (int i = 0; i < risingLeak.length; i++) {
            List<Map<String, Object>> events = node.onReading(
                    reading(pumpId, "seal-leak", risingLeak[i], "2026-07-03T11:00:0" + (i + 1) + ".000Z"));
            if (!events.isEmpty()) {
                critical = events;
            }
        }
        assertEquals(1, critical.size());
        assertEquals("LEAK_CRITICAL", critical.get(0).get("state"));
        persist(critical.get(0));

        List<Map<String, AttributeValue>> items = queryPump(pumpId);
        assertTrue(items.stream().anyMatch(item -> "LEAK_WATCH".equals(item.get("state").s())));
        assertTrue(items.stream().anyMatch(item -> "LEAK_CRITICAL".equals(item.get("state").s())));
    }

    @Test
    void theInsightRelayHandlerActuallyDeliversAnHttpPostedBodyOntoTheRealSqsQueue() {
        // FLOWFORGE_TARGET_QUEUE_URL is exported before this JVM starts (see README/CI), pointing
        // at a queue precreated with the same deterministic floci URL format this asserts against -
        // this proves the exact code path InsightRelayHandler runs in Lambda, not a stand-in.
        String queueUrl = System.getenv("FLOWFORGE_TARGET_QUEUE_URL");
        assertNotNull(queueUrl, "FLOWFORGE_TARGET_QUEUE_URL must be exported before running this test");
        ensureQueue("flowforge-it-relay-queue");

        InsightRelayHandler relay = new InsightRelayHandler(SQS);
        String postedBody = "{\"type\":\"mad_anomaly\",\"pumpId\":\"pump-it-relay\",\"trigger\":\"mad_anomaly\"}";
        Map<String, Object> apiGatewayEvent = Map.of("body", postedBody);

        Map<String, Object> response = relay.handleRequest(apiGatewayEvent, context);
        assertEquals(202, response.get("statusCode"));

        var received = SQS.receiveMessage(ReceiveMessageRequest.builder()
                .queueUrl(queueUrl)
                .waitTimeSeconds(2)
                .maxNumberOfMessages(5)
                .build());

        assertTrue(received.messages().stream().anyMatch(m -> m.body().contains("pump-it-relay")),
                "the HTTP-posted body must have actually landed on the SQS queue via the real relay handler");
    }

    @Test
    void malformedRecordDoesNotSinkTheBatch() {
        Map<String, Object> event = Map.of("Records", List.of(Map.of("body", "not valid json")));
        handler.handleRequest(event, context);
    }

    private static Map<String, Object> reading(String pumpId, String metric, double value, String timestamp) {
        Map<String, Object> reading = new HashMap<>();
        reading.put("pumpId", pumpId);
        reading.put("metric", metric);
        reading.put("value", value);
        reading.put("unit", "");
        reading.put("timestamp", timestamp);
        return reading;
    }
}
