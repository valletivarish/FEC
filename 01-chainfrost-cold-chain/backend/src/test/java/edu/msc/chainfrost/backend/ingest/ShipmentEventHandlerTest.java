package edu.msc.chainfrost.backend.ingest;

import com.amazonaws.services.lambda.runtime.Context;
import com.amazonaws.services.lambda.runtime.LambdaLogger;
import com.amazonaws.services.lambda.runtime.events.KinesisEvent;
import edu.msc.chainfrost.backend.util.JsonMapper;
import edu.msc.chainfrost.fog.common.FogEvent;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;

import java.nio.ByteBuffer;
import java.nio.charset.StandardCharsets;
import java.time.Instant;
import java.util.List;
import java.util.Map;

import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.times;
import static org.mockito.Mockito.verify;

@ExtendWith(MockitoExtension.class)
class ShipmentEventHandlerTest {

    @Mock
    private DynamoWriter dynamoWriter;

    @Mock
    private Context context;

    @Mock
    private LambdaLogger logger;

    private ShipmentEventHandler handler;

    @BeforeEach
    void setUp() {
        handler = new ShipmentEventHandler(dynamoWriter);
    }

    @Test
    void excursionEventWritesZoneSampleAndUpsertsShipmentStatus() throws Exception {
        FogEvent fogEvent = new FogEvent("truck-1", "truck-1-2026-07-02", "EXCURSION_WARN",
                "WARN", Map.of("zone", "zone1", "value", -2.5), Instant.now());

        KinesisEvent event = kinesisEventFor(fogEvent);
        handler.handleRequest(event, context);

        verify(dynamoWriter, times(1)).writeZoneTempSample(any());
        verify(dynamoWriter, times(1)).upsertShipmentStatus(any());
        verify(dynamoWriter, never()).writeFaultEvent(any());
        verify(dynamoWriter, never()).upsertShipmentPosition(any());
    }

    @Test
    void reeferFaultEventWritesFaultEvent() throws Exception {
        FogEvent fogEvent = new FogEvent("truck-2", "truck-2-2026-07-02", "REEFER_FAULT",
                "BREACH", Map.of("code", "COMPRESSOR_OVERCURRENT"), Instant.now());

        KinesisEvent event = kinesisEventFor(fogEvent);
        handler.handleRequest(event, context);

        verify(dynamoWriter, times(1)).writeFaultEvent(any());
        verify(dynamoWriter, never()).writeZoneTempSample(any());
        verify(dynamoWriter, never()).upsertShipmentStatus(any());
    }

    @Test
    void reeferStatusEventUpsertsShipmentHumidityOnly() throws Exception {
        FogEvent fogEvent = new FogEvent("truck-4", "truck-4-2026-07-02", "REEFER_STATUS",
                "INFO", Map.of("humidityPct", 62.0), Instant.now());

        KinesisEvent event = kinesisEventFor(fogEvent);
        handler.handleRequest(event, context);

        verify(dynamoWriter, times(1)).upsertShipmentHumidity(any());
        verify(dynamoWriter, never()).upsertShipmentStatus(any());
        verify(dynamoWriter, never()).writeFaultEvent(any());
        verify(dynamoWriter, never()).upsertShipmentPosition(any());
    }

    @Test
    void telematicsEventUpsertsShipmentPosition() throws Exception {
        FogEvent fogEvent = new FogEvent("truck-3", "truck-3-2026-07-02", "TELEMATICS_ROUTE",
                "INFO", Map.of("lat", 40.7, "lon", -74.0), Instant.now());

        KinesisEvent event = kinesisEventFor(fogEvent);
        handler.handleRequest(event, context);

        verify(dynamoWriter, times(1)).upsertShipmentPosition(any());
        verify(dynamoWriter, never()).writeFaultEvent(any());
    }

    @Test
    void malformedRecordDoesNotThrowAndDoesNotStopProcessing() {
        var mockContext = context;
        org.mockito.Mockito.lenient().when(mockContext.getLogger()).thenReturn(logger);

        KinesisEvent.Record badRecord = new KinesisEvent.Record();
        badRecord.setData(ByteBuffer.wrap("not valid json".getBytes(StandardCharsets.UTF_8)));

        KinesisEvent.KinesisEventRecord kinesisEventRecord = new KinesisEvent.KinesisEventRecord();
        kinesisEventRecord.setKinesis(badRecord);

        KinesisEvent event = new KinesisEvent();
        event.setRecords(List.of(kinesisEventRecord));

        org.junit.jupiter.api.Assertions.assertDoesNotThrow(() -> handler.handleRequest(event, context));
        verify(dynamoWriter, never()).writeZoneTempSample(any());
        verify(dynamoWriter, never()).writeFaultEvent(any());
        verify(dynamoWriter, never()).upsertShipmentPosition(any());
        verify(dynamoWriter, never()).upsertShipmentStatus(any());
    }

    private KinesisEvent kinesisEventFor(FogEvent fogEvent) throws Exception {
        org.mockito.Mockito.lenient().when(context.getLogger()).thenReturn(logger);

        String json = JsonMapper.INSTANCE.writeValueAsString(fogEvent);
        KinesisEvent.Record record = new KinesisEvent.Record();
        record.setData(ByteBuffer.wrap(json.getBytes(StandardCharsets.UTF_8)));

        KinesisEvent.KinesisEventRecord kinesisEventRecord = new KinesisEvent.KinesisEventRecord();
        kinesisEventRecord.setKinesis(record);

        KinesisEvent event = new KinesisEvent();
        event.setRecords(List.of(kinesisEventRecord));
        return event;
    }
}
