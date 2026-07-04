package edu.msc.chainfrost.fog.reeferhealthfog;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.mockito.Mockito.atLeastOnce;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.verify;

import java.time.Duration;
import java.time.Instant;
import java.util.List;

import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.mockito.ArgumentCaptor;

import edu.msc.chainfrost.fog.common.FogEvent;
import edu.msc.chainfrost.fog.common.KinesisDispatchClient;
import edu.msc.chainfrost.reefersim.model.SensorReading;

class ReeferHealthFogNodeTest {

    private static final String TRUCK_ID = "truck-9";

    private KinesisDispatchClient dispatchClient;
    private ReeferHealthFogNode node;
    private Instant t0;

    @BeforeEach
    void setUp() {
        dispatchClient = mock(KinesisDispatchClient.class);
        node = new ReeferHealthFogNode(dispatchClient);
        t0 = Instant.parse("2026-07-02T10:00:00Z");
    }

    @Test
    void humidityReadingDispatchesReeferStatusWithHumidityPct() {
        node.onHumidityReading(new SensorReading(TRUCK_ID, "chainfrost/" + TRUCK_ID + "/reefer/humidity", 62.0, t0));

        ArgumentCaptor<FogEvent> captor = ArgumentCaptor.forClass(FogEvent.class);
        verify(dispatchClient).dispatch(captor.capture());

        FogEvent event = captor.getValue();
        assertEquals("REEFER_STATUS", event.eventType());
        assertEquals("INFO", event.severity());
        assertEquals(62.0, event.payload().get("humidityPct"));
    }

    @Test
    void doorAjarInTransitWithHighHumidityDispatchesBreachSeverityFault() {
        node.onSpeedReading(new SensorReading(TRUCK_ID, "chainfrost/" + TRUCK_ID + "/telematics/speed", 60.0, t0));
        node.onHumidityReading(new SensorReading(TRUCK_ID, "chainfrost/" + TRUCK_ID + "/reefer/humidity", 92.0, t0));
        node.onDoorStateReading(new SensorReading(TRUCK_ID, "chainfrost/" + TRUCK_ID + "/reefer/door_state", 1.0, t0));
        node.onDoorStateReading(new SensorReading(
                TRUCK_ID, "chainfrost/" + TRUCK_ID + "/reefer/door_state", 1.0, t0.plus(Duration.ofSeconds(91))));

        ArgumentCaptor<FogEvent> captor = ArgumentCaptor.forClass(FogEvent.class);
        verify(dispatchClient, atLeastOnce()).dispatch(captor.capture());

        List<FogEvent> events = captor.getAllValues();
        FogEvent faultEvent = events.stream()
                .filter(e -> "REEFER_FAULT".equals(e.eventType()))
                .findFirst()
                .orElseThrow(() -> new AssertionError("expected a REEFER_FAULT event to be dispatched"));

        assertEquals("BREACH", faultEvent.severity());
        assertEquals("SEAL_BREACH_SUSPECTED", faultEvent.payload().get("faultType"));
    }

    @Test
    void doorAjarInTransitWithNormalHumidityStaysWarnSeverity() {
        node.onSpeedReading(new SensorReading(TRUCK_ID, "chainfrost/" + TRUCK_ID + "/telematics/speed", 60.0, t0));
        node.onHumidityReading(new SensorReading(TRUCK_ID, "chainfrost/" + TRUCK_ID + "/reefer/humidity", 55.0, t0));
        node.onDoorStateReading(new SensorReading(TRUCK_ID, "chainfrost/" + TRUCK_ID + "/reefer/door_state", 1.0, t0));
        node.onDoorStateReading(new SensorReading(
                TRUCK_ID, "chainfrost/" + TRUCK_ID + "/reefer/door_state", 1.0, t0.plus(Duration.ofSeconds(91))));

        ArgumentCaptor<FogEvent> captor = ArgumentCaptor.forClass(FogEvent.class);
        verify(dispatchClient, atLeastOnce()).dispatch(captor.capture());

        List<FogEvent> events = captor.getAllValues();
        FogEvent faultEvent = events.stream()
                .filter(e -> "REEFER_FAULT".equals(e.eventType()))
                .findFirst()
                .orElseThrow(() -> new AssertionError("expected a REEFER_FAULT event to be dispatched"));

        assertEquals("WARN", faultEvent.severity());
        assertEquals("DOOR_AJAR_IN_TRANSIT", faultEvent.payload().get("faultType"));
    }
}
