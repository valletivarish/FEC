package edu.msc.chainfrost.backend.ingest;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;

import java.time.Instant;
import java.util.Map;

import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.ArgumentCaptor;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;

import edu.msc.chainfrost.fog.common.FogEvent;
import software.amazon.awssdk.services.dynamodb.DynamoDbClient;
import software.amazon.awssdk.services.dynamodb.model.UpdateItemRequest;

@ExtendWith(MockitoExtension.class)
class DynamoWriterTest {

    @Mock
    private DynamoDbClient dynamoDbClient;

    private DynamoWriter writer;

    @BeforeEach
    void setUp() {
        writer = new DynamoWriter(dynamoDbClient, "ZoneTempTable", "ChainFrostShipments", "FaultsTable");
    }

    @Test
    void upsertShipmentHumidityUpdatesOnlyHumidityFields() {
        FogEvent event = new FogEvent("truck-5", "truck-5-2026-07-02", "REEFER_STATUS",
                "INFO", Map.of("humidityPct", 71.5), Instant.parse("2026-07-02T10:00:00Z"));

        writer.upsertShipmentHumidity(event);

        ArgumentCaptor<UpdateItemRequest> captor = ArgumentCaptor.forClass(UpdateItemRequest.class);
        verify(dynamoDbClient).updateItem(captor.capture());

        UpdateItemRequest request = captor.getValue();
        assertEquals("ChainFrostShipments", request.tableName());
        assertEquals("truck-5-2026-07-02", request.key().get("shipmentId").s());
        assertEquals("71.5", request.expressionAttributeValues().get(":humidityPct").n());
        assertEquals("truck-5", request.expressionAttributeValues().get(":truckId").s());
    }

    @Test
    void upsertShipmentHumidityDoesNothingWhenPayloadHasNoHumidity() {
        FogEvent event = new FogEvent("truck-6", "truck-6-2026-07-02", "REEFER_STATUS",
                "INFO", Map.of(), Instant.now());

        writer.upsertShipmentHumidity(event);

        verify(dynamoDbClient, never()).updateItem(any(UpdateItemRequest.class));
    }

    @Test
    void upsertShipmentStatusWritesZone1TempAndSetpointViaUpdateItem() {
        FogEvent event = new FogEvent("truck-7", "truck-7-2026-07-02", "EXCURSION_WARN", "WARN",
                Map.of("zone", "zone1", "currentTempCelsius", -15.6, "setpointCelsius", -18.0,
                        "meanKineticTempCelsius", -16.1),
                Instant.parse("2026-07-02T10:00:00Z"));

        writer.upsertShipmentStatus(event);

        ArgumentCaptor<UpdateItemRequest> captor = ArgumentCaptor.forClass(UpdateItemRequest.class);
        verify(dynamoDbClient).updateItem(captor.capture());

        UpdateItemRequest request = captor.getValue();
        assertEquals("ChainFrostShipments", request.tableName());
        assertEquals("truck-7-2026-07-02", request.key().get("shipmentId").s());
        assertEquals("WARN", request.expressionAttributeValues().get(":complianceStatus").s());
        assertEquals("-15.6", request.expressionAttributeValues().get(":zoneTemp").n());
        assertEquals("-18.0", request.expressionAttributeValues().get(":setpointC").n());
        assertEquals("-16.1", request.expressionAttributeValues().get(":latestMkt").n());
        assertTrue(request.updateExpression().contains("latestZone1Temp = :zoneTemp"));
    }

    @Test
    void upsertShipmentStatusWritesZone2TempIntoZone2Column() {
        FogEvent event = new FogEvent("truck-8", "truck-8-2026-07-02", "EXCURSION_WARN", "WARN",
                Map.of("zone", "zone2", "currentTempCelsius", -14.2, "setpointCelsius", -18.0),
                Instant.parse("2026-07-02T10:00:00Z"));

        writer.upsertShipmentStatus(event);

        ArgumentCaptor<UpdateItemRequest> captor = ArgumentCaptor.forClass(UpdateItemRequest.class);
        verify(dynamoDbClient).updateItem(captor.capture());

        UpdateItemRequest request = captor.getValue();
        assertTrue(request.updateExpression().contains("latestZone2Temp = :zoneTemp"));
        assertFalse(request.updateExpression().contains("latestZone1Temp"));
    }

    @Test
    void upsertShipmentPositionWritesAllTelematicsFieldsViaUpdateItem() {
        // "gForce" (not "shock") is the exact payload key TelematicsFogNode.onShockReading dispatches with.
        FogEvent event = new FogEvent("truck-9", "truck-9-2026-07-02", "TELEMATICS_GPS", "INFO",
                Map.of("lat", 53.35, "lon", -6.26, "speed", 88.4, "gForce", 0.3),
                Instant.parse("2026-07-02T11:00:00Z"));

        writer.upsertShipmentPosition(event);

        ArgumentCaptor<UpdateItemRequest> captor = ArgumentCaptor.forClass(UpdateItemRequest.class);
        verify(dynamoDbClient).updateItem(captor.capture());
        verify(dynamoDbClient, never()).putItem(any(software.amazon.awssdk.services.dynamodb.model.PutItemRequest.class));

        UpdateItemRequest request = captor.getValue();
        assertEquals("ChainFrostShipments", request.tableName());
        assertEquals("truck-9-2026-07-02", request.key().get("shipmentId").s());
        assertEquals("truck-9", request.expressionAttributeValues().get(":truckId").s());
        assertEquals("TELEMATICS_GPS", request.expressionAttributeValues().get(":lastEventType").s());
        assertEquals("53.35", request.expressionAttributeValues().get(":lastLat").n());
        assertEquals("-6.26", request.expressionAttributeValues().get(":lastLon").n());
        assertEquals("88.4", request.expressionAttributeValues().get(":lastSpeed").n());
        assertEquals("0.3", request.expressionAttributeValues().get(":lastShock").n());
        assertTrue(request.updateExpression().contains("lastLat = :lastLat"));
        assertTrue(request.updateExpression().contains("lastLon = :lastLon"));
        assertTrue(request.updateExpression().contains("lastSpeed = :lastSpeed"));
        assertTrue(request.updateExpression().contains("lastShock = :lastShock"));
        assertFalse(request.updateExpression().contains("complianceStatus"));
    }

    @Test
    void upsertShipmentPositionOmitsAbsentFieldsFromUpdateExpression() {
        FogEvent event = new FogEvent("truck-10", "truck-10-2026-07-02", "TELEMATICS_GPS", "INFO",
                Map.of("lat", 53.34, "lon", -6.27),
                Instant.parse("2026-07-02T11:05:00Z"));

        writer.upsertShipmentPosition(event);

        ArgumentCaptor<UpdateItemRequest> captor = ArgumentCaptor.forClass(UpdateItemRequest.class);
        verify(dynamoDbClient).updateItem(captor.capture());

        UpdateItemRequest request = captor.getValue();
        assertTrue(request.updateExpression().contains("lastLat = :lastLat"));
        assertTrue(request.updateExpression().contains("lastLon = :lastLon"));
        assertFalse(request.updateExpression().contains("lastSpeed"));
        assertFalse(request.updateExpression().contains("lastShock"));
        assertFalse(request.expressionAttributeValues().containsKey(":lastSpeed"));
        assertFalse(request.expressionAttributeValues().containsKey(":lastShock"));
    }
}
