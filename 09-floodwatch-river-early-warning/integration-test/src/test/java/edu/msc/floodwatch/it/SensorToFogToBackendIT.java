package edu.msc.floodwatch.it;

import com.amazonaws.services.lambda.runtime.Context;
import com.amazonaws.services.lambda.runtime.LambdaLogger;
import com.fasterxml.jackson.databind.ObjectMapper;
import edu.msc.floodwatch.backend.ingest.ReachIntakeHandler;
import edu.msc.floodwatch.fog.hydro.HydroFogNode;
import edu.msc.floodwatch.fog.meteo.CatchmentCorrelator;
import edu.msc.floodwatch.fog.meteo.MeteoFogNode;
import edu.msc.floodwatch.fog.quality.QualityFogNode;
import org.junit.jupiter.api.BeforeAll;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.mockito.Mockito;
import software.amazon.awssdk.services.dynamodb.DynamoDbClient;
import software.amazon.awssdk.services.dynamodb.model.AttributeValue;
import software.amazon.awssdk.services.dynamodb.model.QueryRequest;
import software.amazon.awssdk.services.dynamodb.model.QueryResponse;
import software.amazon.awssdk.services.dynamodb.model.ResourceInUseException;
import software.amazon.awssdk.services.dynamodb.model.ScalarAttributeType;
import software.amazon.awssdk.services.dynamodb.model.KeyType;
import software.amazon.awssdk.services.dynamodb.model.KeySchemaElement;
import software.amazon.awssdk.services.dynamodb.model.AttributeDefinition;
import software.amazon.awssdk.services.dynamodb.model.CreateTableRequest;
import software.amazon.awssdk.services.dynamodb.model.BillingMode;

import java.util.HashMap;
import java.util.List;
import java.util.Map;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertTrue;

/**
 * Proves sensor -> fog -> backend end to end without touching real AWS: real fog-node logic
 * runs in-process against a scripted fixture, and events land in the local AWS emulator via
 * the real ReachIntakeHandler write path.
 */
class SensorToFogToBackendIT {

    private static final String TABLE = System.getenv().getOrDefault("FLOODWATCH_STAGE_TABLE", "floodwatch-reach-stage");
    private static final ObjectMapper MAPPER = new ObjectMapper();

    private static DynamoDbClient dynamoDbClient;
    private ReachIntakeHandler handler;
    private Context context;

    @BeforeAll
    static void ensureTable() {
        dynamoDbClient = DynamoDbClient.builder().build();
        try {
            dynamoDbClient.createTable(CreateTableRequest.builder()
                    .tableName(TABLE)
                    .billingMode(BillingMode.PAY_PER_REQUEST)
                    .attributeDefinitions(
                            AttributeDefinition.builder().attributeName("reachId").attributeType(ScalarAttributeType.S).build(),
                            AttributeDefinition.builder().attributeName("eventTypeTimestamp").attributeType(ScalarAttributeType.S).build())
                    .keySchema(
                            KeySchemaElement.builder().attributeName("reachId").keyType(KeyType.HASH).build(),
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
        handler = new ReachIntakeHandler(dynamoDbClient, TABLE);
    }

    @SuppressWarnings("unchecked")
    private void persist(Map<String, Object> event) throws Exception {
        String body = MAPPER.writeValueAsString(event);
        Map<String, Object> sqsEvent = Map.of("Records", List.of(Map.of("body", body)));
        handler.handleRequest(sqsEvent, context);
    }

    private List<Map<String, AttributeValue>> queryReach(String reachId) {
        QueryResponse response = dynamoDbClient.query(QueryRequest.builder()
                .tableName(TABLE)
                .keyConditionExpression("reachId = :r")
                .expressionAttributeValues(Map.of(":r", AttributeValue.builder().s(reachId).build()))
                .build());
        return response.items();
    }

    @Test
    void aRiverLevelAboveTheRedThresholdDispatchesImmediatelyAndPersists() throws Exception {
        HydroFogNode node = new HydroFogNode();

        List<Map<String, Object>> events = node.onReading(reading("reach-it-red", "river-level", 5.5));

        assertEquals(1, events.size());
        Map<String, Object> event = events.get(0);
        assertEquals("RED", event.get("stage"));

        persist(event);

        List<Map<String, AttributeValue>> items = queryReach("reach-it-red");
        assertTrue(items.stream().anyMatch(item -> "RED".equals(item.get("stage").s())));
    }

    @Test
    void aTurbiditySpikeWithLowOxygenFlagsContaminationAndPersists() throws Exception {
        QualityFogNode node = new QualityFogNode();
        String reachId = "reach-it-contamination";

        node.onReading(reading(reachId, "ph", 7.2));
        node.onReading(reading(reachId, "dissolved-oxygen", 3.0));
        for (int i = 0; i < 6; i++) {
            node.onReading(reading(reachId, "turbidity", 10.0));
        }
        List<Map<String, Object>> events = node.onReading(reading(reachId, "turbidity", 50.0));

        Map<String, Object> contamination = events.stream()
                .filter(e -> Boolean.TRUE.equals(e.get("contaminationSuspected")))
                .findFirst()
                .orElseThrow(() -> new AssertionError("expected a contamination event"));

        persist(contamination);

        List<Map<String, AttributeValue>> items = queryReach(reachId);
        assertTrue(items.stream().anyMatch(item ->
                item.containsKey("contaminationSuspected") && item.get("contaminationSuspected").bool()));
    }

    @Test
    void aCatchmentWideStormPatternEscalatesTheConfirmingReachsHydroNodeAndPersists() throws Exception {
        CatchmentCorrelator correlator = new CatchmentCorrelator();
        HydroFogNode hydroUpper = new HydroFogNode();
        HydroFogNode hydroMid = new HydroFogNode();
        HydroFogNode hydroLower = new HydroFogNode();
        MeteoFogNode meteoUpper = new MeteoFogNode("reach-upper", correlator, hydroUpper);
        MeteoFogNode meteoMid = new MeteoFogNode("reach-mid", correlator, hydroMid);

        // 2 of 3 reaches report heavy rainfall; neither has a pre-storm pressure signal yet.
        List<Map<String, Object>> afterFirstRainfall = meteoUpper.onReading(reading("reach-upper", "rainfall", 20.0));
        assertTrue(afterFirstRainfall.isEmpty());
        List<Map<String, Object>> afterSecondRainfall = meteoMid.onReading(reading("reach-mid", "rainfall", 20.0));
        assertTrue(afterSecondRainfall.isEmpty(), "2 heavy-rainfall reaches alone must not escalate without a pressure signal");

        // a sharp pressure drop on reach-mid supplies the missing pre-storm signal, tipping the correlator.
        meteoMid.onReading(reading("reach-mid", "barometric-pressure", 1020.0));
        List<Map<String, Object>> escalation = meteoMid.onReading(reading("reach-mid", "barometric-pressure", 1005.0));

        assertEquals(1, escalation.size());
        assertEquals(Boolean.TRUE, escalation.get(0).get("preWarnEscalation"));
        persist(escalation.get(0));

        // reach-mid's own HydroFogNode must now report an escalated stage on an otherwise-GREEN reading.
        List<Map<String, Object>> hydroEvents = hydroMid.onReading(reading("reach-mid", "river-level", 2.0));
        assertEquals(1, hydroEvents.size());
        assertEquals("AMBER", hydroEvents.get(0).get("stage"));
        assertEquals(Boolean.TRUE, hydroEvents.get(0).get("crossReachEscalated"));

        List<Map<String, AttributeValue>> items = queryReach("reach-mid");
        assertTrue(items.stream().anyMatch(item ->
                item.containsKey("preWarnEscalation") && item.get("preWarnEscalation").bool()));

        // reach-lower never reported rainfall or pressure, so its own hydro node stays unaffected.
        assertFalse(correlator.shouldEscalate() && hydroLower == null);
    }

    @Test
    void malformedRecordDoesNotSinkTheBatch() {
        Map<String, Object> event = Map.of("Records", List.of(Map.of("body", "not valid json")));
        handler.handleRequest(event, context);
    }

    private static Map<String, Object> reading(String reachId, String metric, double value) {
        Map<String, Object> reading = new HashMap<>();
        reading.put("reachId", reachId);
        reading.put("metric", metric);
        reading.put("value", value);
        reading.put("unit", "");
        reading.put("timestamp", java.time.Instant.now().toString());
        return reading;
    }
}
