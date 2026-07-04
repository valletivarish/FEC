package edu.msc.chainfrost.it;

import com.amazonaws.services.lambda.runtime.Context;
import com.amazonaws.services.lambda.runtime.LambdaLogger;
import com.amazonaws.services.lambda.runtime.events.KinesisEvent;
import com.fasterxml.jackson.databind.node.JsonNodeFactory;
import com.fasterxml.jackson.databind.node.ObjectNode;
import edu.msc.chainfrost.backend.ingest.DynamoWriter;
import edu.msc.chainfrost.backend.ingest.ShipmentEventHandler;
import edu.msc.chainfrost.backend.util.JsonMapper;
import edu.msc.chainfrost.fog.common.FogEvent;
import edu.msc.chainfrost.fog.common.KinesisDispatchClient;
import edu.msc.chainfrost.fog.common.ShipmentIds;
import edu.msc.chainfrost.fog.reeferhealthfog.ReeferHealthFogNode;
import edu.msc.chainfrost.fog.telematicsfog.TelematicsFogNode;
import edu.msc.chainfrost.fog.tempfog.TempFogNode;
import edu.msc.chainfrost.reefersim.model.SensorReading;
import org.junit.jupiter.api.Assumptions;
import org.junit.jupiter.api.BeforeAll;
import org.junit.jupiter.api.Test;
import org.mockito.Mockito;
import software.amazon.awssdk.auth.credentials.AwsBasicCredentials;
import software.amazon.awssdk.auth.credentials.StaticCredentialsProvider;
import software.amazon.awssdk.regions.Region;
import software.amazon.awssdk.services.dynamodb.DynamoDbClient;
import software.amazon.awssdk.services.dynamodb.model.AttributeDefinition;
import software.amazon.awssdk.services.dynamodb.model.AttributeValue;
import software.amazon.awssdk.services.dynamodb.model.BillingMode;
import software.amazon.awssdk.services.dynamodb.model.CreateTableRequest;
import software.amazon.awssdk.services.dynamodb.model.GetItemRequest;
import software.amazon.awssdk.services.dynamodb.model.KeySchemaElement;
import software.amazon.awssdk.services.dynamodb.model.KeyType;
import software.amazon.awssdk.services.dynamodb.model.QueryRequest;
import software.amazon.awssdk.services.dynamodb.model.ResourceInUseException;
import software.amazon.awssdk.services.dynamodb.model.ScalarAttributeType;
import software.amazon.awssdk.services.kinesis.KinesisClient;

import java.net.InetSocketAddress;
import java.net.Socket;
import java.net.URI;
import java.nio.ByteBuffer;
import java.nio.charset.StandardCharsets;
import java.time.Duration;
import java.time.Instant;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.concurrent.CopyOnWriteArrayList;

import static org.junit.jupiter.api.Assertions.assertDoesNotThrow;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertTrue;

/**
 * Proves sensor -> fog -> backend end to end without touching real AWS: real fog-node logic
 * runs in-process against a scripted fixture, and events land in the local AWS emulator.
 */
class SensorToFogToBackendIT {

    private static final String ZONE_TEMP_TABLE = "ChainFrostZoneTemperatureSeries";
    private static final String SHIPMENTS_TABLE = "ChainFrostShipments";
    private static final String FAULTS_TABLE = "ChainFrostFaultEvents";

    private static final String TRUCK_ID = "TRUCK-IT-01";
    private static final double SETPOINT = -18.0;

    private static DynamoDbClient dynamoDbClient;
    private static ShipmentEventHandler shipmentEventHandler;
    private static Context lambdaContext;

    @BeforeAll
    static void setUpEmulatorAndTables() {
        String endpoint = System.getenv().getOrDefault("DYNAMODB_ENDPOINT_OVERRIDE", "http://localhost:4566");
        Assumptions.assumeTrue(isReachable(endpoint), "local AWS emulator not reachable at " + endpoint);

        dynamoDbClient = DynamoDbClient.builder()
                .endpointOverride(URI.create(endpoint))
                .region(Region.US_EAST_1)
                .credentialsProvider(StaticCredentialsProvider.create(AwsBasicCredentials.create("test", "test")))
                .build();

        try {
            dynamoDbClient.listTables();
        } catch (RuntimeException e) {
            Assumptions.assumeTrue(false, "local AWS emulator not reachable: " + e.getMessage());
        }

        createTableIfAbsent(zoneTempTableRequest());
        createTableIfAbsent(shipmentsTableRequest());
        createTableIfAbsent(faultsTableRequest());

        shipmentEventHandler = new ShipmentEventHandler(new DynamoWriter(dynamoDbClient));

        lambdaContext = Mockito.mock(Context.class);
        LambdaLogger logger = Mockito.mock(LambdaLogger.class);
        Mockito.lenient().when(lambdaContext.getLogger()).thenReturn(logger);
    }

    private static boolean isReachable(String endpoint) {
        try {
            URI uri = URI.create(endpoint);
            int port = uri.getPort() == -1 ? 80 : uri.getPort();
            try (Socket socket = new Socket()) {
                socket.connect(new InetSocketAddress(uri.getHost(), port), 750);
                return true;
            }
        } catch (Exception e) {
            return false;
        }
    }

    private static void createTableIfAbsent(CreateTableRequest request) {
        try {
            dynamoDbClient.createTable(request);
        } catch (ResourceInUseException alreadyExists) {
            // the table surviving across local runs is the point of "if absent"
        }
    }

    private static CreateTableRequest zoneTempTableRequest() {
        return CreateTableRequest.builder()
                .tableName(ZONE_TEMP_TABLE)
                .billingMode(BillingMode.PAY_PER_REQUEST)
                .attributeDefinitions(
                        AttributeDefinition.builder().attributeName("truckId").attributeType(ScalarAttributeType.S).build(),
                        AttributeDefinition.builder().attributeName("zoneTimestamp").attributeType(ScalarAttributeType.S).build())
                .keySchema(
                        KeySchemaElement.builder().attributeName("truckId").keyType(KeyType.HASH).build(),
                        KeySchemaElement.builder().attributeName("zoneTimestamp").keyType(KeyType.RANGE).build())
                .build();
    }

    private static CreateTableRequest shipmentsTableRequest() {
        return CreateTableRequest.builder()
                .tableName(SHIPMENTS_TABLE)
                .billingMode(BillingMode.PAY_PER_REQUEST)
                .attributeDefinitions(
                        AttributeDefinition.builder().attributeName("shipmentId").attributeType(ScalarAttributeType.S).build())
                .keySchema(KeySchemaElement.builder().attributeName("shipmentId").keyType(KeyType.HASH).build())
                .build();
    }

    private static CreateTableRequest faultsTableRequest() {
        return CreateTableRequest.builder()
                .tableName(FAULTS_TABLE)
                .billingMode(BillingMode.PAY_PER_REQUEST)
                .attributeDefinitions(
                        AttributeDefinition.builder().attributeName("truckId").attributeType(ScalarAttributeType.S).build(),
                        AttributeDefinition.builder().attributeName("eventTimestamp").attributeType(ScalarAttributeType.S).build())
                .keySchema(
                        KeySchemaElement.builder().attributeName("truckId").keyType(KeyType.HASH).build(),
                        KeySchemaElement.builder().attributeName("eventTimestamp").keyType(KeyType.RANGE).build())
                .build();
    }

    /**
     * Records events instead of calling real Kinesis - overriding dispatch() is simpler
     * than standing up a Kinesis consumer just to feed the backend handler in-test.
     */
    private static final class RecordingDispatchClient extends KinesisDispatchClient {
        private final List<FogEvent> dispatched = new CopyOnWriteArrayList<>();

        RecordingDispatchClient(KinesisClient unusedClient) {
            super(unusedClient);
        }

        @Override
        public void dispatch(FogEvent event) {
            dispatched.add(event);
        }

        List<FogEvent> dispatched() {
            return dispatched;
        }
    }

    private static RecordingDispatchClient newRecordingDispatchClient() {
        KinesisClient unusedClient = KinesisClient.builder()
                .endpointOverride(URI.create(System.getenv().getOrDefault("DYNAMODB_ENDPOINT_OVERRIDE", "http://localhost:4566")))
                .region(Region.US_EAST_1)
                .credentialsProvider(StaticCredentialsProvider.create(AwsBasicCredentials.create("test", "test")))
                .build();
        return new RecordingDispatchClient(unusedClient);
    }

    private static void replayThroughBackend(List<FogEvent> events) throws Exception {
        List<KinesisEvent.KinesisEventRecord> records = new ArrayList<>();
        for (FogEvent event : events) {
            String json = JsonMapper.INSTANCE.writeValueAsString(event);
            KinesisEvent.Record kinesisRecord = new KinesisEvent.Record();
            kinesisRecord.setData(ByteBuffer.wrap(json.getBytes(StandardCharsets.UTF_8)));
            KinesisEvent.KinesisEventRecord wrapper = new KinesisEvent.KinesisEventRecord();
            wrapper.setKinesis(kinesisRecord);
            records.add(wrapper);
        }
        KinesisEvent kinesisEvent = new KinesisEvent();
        kinesisEvent.setRecords(records);
        shipmentEventHandler.handleRequest(kinesisEvent, lambdaContext);
    }

    @Test
    void sustainedZoneOneExcursionProducesShipmentAndFaultRows() throws Exception {
        RecordingDispatchClient dispatchClient = newRecordingDispatchClient();
        TempFogNode tempFogNode = new TempFogNode(dispatchClient);

        Instant start = Instant.now();
        tempFogNode.onSetpointReading(new SensorReading(TRUCK_ID, "chainfrost/" + TRUCK_ID + "/reefer/setpoint", SETPOINT, start));

        // 12 synthetic minutes above setpoint+tolerance so MKT stays over the sustained-breach threshold
        double excursionValue = SETPOINT + 5.0;
        for (int minute = 0; minute <= 12; minute++) {
            SensorReading reading = new SensorReading(TRUCK_ID, "chainfrost/" + TRUCK_ID + "/reefer/zone1/temp",
                    excursionValue, start.plus(Duration.ofMinutes(minute)));
            tempFogNode.onZone1Reading(reading);
        }

        List<FogEvent> events = dispatchClient.dispatched();
        assertFalse(events.isEmpty(), "sustained excursion fixture should have produced at least one fog event");
        assertTrue(events.stream().anyMatch(e -> "EXCURSION_BREACH".equals(e.eventType())),
                "12 minutes above setpoint plus tolerance should escalate to a sustained breach");

        replayThroughBackend(events);

        String shipmentId = ShipmentIds.forTruckNow(TRUCK_ID);
        GetItemRequest shipmentLookup = GetItemRequest.builder()
                .tableName(SHIPMENTS_TABLE)
                .key(Map.of("shipmentId", AttributeValue.fromS(shipmentId)))
                .build();
        Map<String, AttributeValue> shipmentItem = dynamoDbClient.getItem(shipmentLookup).item();
        assertFalse(shipmentItem.isEmpty(), "breach should have upserted a ChainFrostShipments row for " + shipmentId);

        QueryRequest zoneQuery = QueryRequest.builder()
                .tableName(ZONE_TEMP_TABLE)
                .keyConditionExpression("truckId = :truckId")
                .expressionAttributeValues(Map.of(":truckId", AttributeValue.fromS(TRUCK_ID)))
                .build();
        assertFalse(dynamoDbClient.query(zoneQuery).items().isEmpty(),
                "excursion samples should have landed in the zone-temperature table for " + TRUCK_ID);
    }

    @Test
    void harshShockAndReeferFaultReadingsFlowThroughWithoutThrowing() throws Exception {
        RecordingDispatchClient dispatchClient = newRecordingDispatchClient();
        TelematicsFogNode telematicsFogNode = new TelematicsFogNode(dispatchClient);
        ReeferHealthFogNode reeferHealthFogNode = new ReeferHealthFogNode(dispatchClient);

        Instant now = Instant.now();

        // 9.5g is well past the 2.5g dispatch threshold; the node should classify and dispatch, not throw
        SensorReading harshShock = new SensorReading(TRUCK_ID, "chainfrost/" + TRUCK_ID + "/telematics/shock", 9.5, now);
        assertDoesNotThrow(() -> telematicsFogNode.onShockReading(harshShock));

        // compressor pegged high for a sustained window should raise a COMPRESSOR_OVERLOAD fault
        reeferHealthFogNode.onSetpointReading(new SensorReading(TRUCK_ID, "chainfrost/" + TRUCK_ID + "/reefer/setpoint", SETPOINT, now));
        for (int minute = 0; minute <= 4; minute++) {
            SensorReading overCurrent = new SensorReading(TRUCK_ID, "chainfrost/" + TRUCK_ID + "/reefer/compressor_current",
                    17.5, now.plus(Duration.ofMinutes(minute)));
            assertDoesNotThrow(() -> reeferHealthFogNode.onCompressorCurrentReading(overCurrent));
        }

        List<FogEvent> events = dispatchClient.dispatched();
        assertTrue(events.stream().anyMatch(e -> "TELEMATICS_SHOCK".equals(e.eventType())),
                "a shock above threshold should dispatch a TELEMATICS_SHOCK event");

        assertDoesNotThrow(() -> replayThroughBackend(events));
    }

    @Test
    void humidityReadingFlowsThroughToPersistedShipmentRecord() throws Exception {
        RecordingDispatchClient dispatchClient = newRecordingDispatchClient();
        ReeferHealthFogNode reeferHealthFogNode = new ReeferHealthFogNode(dispatchClient);

        Instant now = Instant.now();
        SensorReading humidityReading = new SensorReading(
                TRUCK_ID, "chainfrost/" + TRUCK_ID + "/reefer/humidity", 88.0, now);
        reeferHealthFogNode.onHumidityReading(humidityReading);

        List<FogEvent> events = dispatchClient.dispatched();
        assertTrue(events.stream().anyMatch(e -> "REEFER_STATUS".equals(e.eventType())),
                "a humidity reading should dispatch a REEFER_STATUS event");

        replayThroughBackend(events);

        String shipmentId = ShipmentIds.forTruckNow(TRUCK_ID);
        GetItemRequest shipmentLookup = GetItemRequest.builder()
                .tableName(SHIPMENTS_TABLE)
                .key(Map.of("shipmentId", AttributeValue.fromS(shipmentId)))
                .build();
        Map<String, AttributeValue> shipmentItem = dynamoDbClient.getItem(shipmentLookup).item();
        assertFalse(shipmentItem.isEmpty(), "humidity status should have upserted a ChainFrostShipments row for " + shipmentId);
        assertTrue(shipmentItem.containsKey("humidityPct"), "shipment row should carry the humidityPct field");
        assertTrue(Math.abs(88.0 - Double.parseDouble(shipmentItem.get("humidityPct").n())) < 0.001);
    }

    /**
     * Confirms GPS payloads route through the JSON-object entry point without throwing;
     * route batching itself is exercised in fog-nodes unit tests, not repeated here.
     */
    @Test
    void gpsReadingIsAcceptedWithoutThrowing() {
        RecordingDispatchClient dispatchClient = newRecordingDispatchClient();
        TelematicsFogNode telematicsFogNode = new TelematicsFogNode(dispatchClient);

        ObjectNode gpsPayload = JsonNodeFactory.instance.objectNode();
        gpsPayload.put("lat", 40.7128);
        gpsPayload.put("lon", -74.0060);

        assertDoesNotThrow(() -> telematicsFogNode.onGpsReading(TRUCK_ID, gpsPayload));
    }
}
