package edu.msc.chainfrost.reefersim.simulation;

import edu.msc.chainfrost.reefersim.config.SensorProfile;
import edu.msc.chainfrost.reefersim.model.SensorReading;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.Test;

import java.util.ArrayList;
import java.util.List;
import java.util.Random;
import java.util.concurrent.CopyOnWriteArrayList;
import java.util.concurrent.Executors;
import java.util.concurrent.ScheduledExecutorService;
import java.util.concurrent.TimeUnit;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertTrue;

class SensorSimulatorTest {

    private static final String TRUCK_ID = "truck-01";

    private final List<ScheduledExecutorService> executorsToClose = new ArrayList<>();

    @AfterEach
    void tearDown() {
        executorsToClose.forEach(ScheduledExecutorService::shutdownNow);
    }

    @Test
    void randomWalkStaysWithinBounds() {
        SensorProfile profile = new SensorProfile(
                "chainfrost/" + TRUCK_ID + "/reefer/zone1/temp", "celsius", -30, 10, 100, 200, "RANDOM_WALK");
        SensorSimulator simulator = new SensorSimulator(TRUCK_ID, profile, noopExecutor(), r -> {}, new Random(42));

        for (int i = 0; i < 500; i++) {
            double value = simulator.nextValue();
            assertTrue(value >= profile.min() && value <= profile.max(),
                    "RANDOM_WALK value out of range: " + value);
        }
    }

    @Test
    void diurnalCycleStaysWithinBounds() {
        SensorProfile profile = new SensorProfile(
                "chainfrost/" + TRUCK_ID + "/reefer/humidity", "percent_rh", 40, 95, 100, 200, "DIURNAL_CYCLE");
        SensorSimulator simulator = new SensorSimulator(TRUCK_ID, profile, noopExecutor(), r -> {}, new Random(7));

        for (int i = 0; i < 500; i++) {
            double value = simulator.nextValue();
            assertTrue(value >= profile.min() && value <= profile.max(),
                    "DIURNAL_CYCLE value out of range: " + value);
        }
    }

    @Test
    void booleanFlickerOnlyEmitsZeroOrOne() {
        SensorProfile profile = new SensorProfile(
                "chainfrost/" + TRUCK_ID + "/reefer/door_state", "boolean", 0, 1, 50, 100, "BOOLEAN_FLICKER");
        SensorSimulator simulator = new SensorSimulator(TRUCK_ID, profile, noopExecutor(), r -> {}, new Random(3));

        for (int i = 0; i < 500; i++) {
            double value = simulator.nextValue();
            assertTrue(value == 0.0 || value == 1.0, "BOOLEAN_FLICKER produced non-boolean value: " + value);
        }
    }

    @Test
    void gpsRandomWalkLatitudeStaysNearOrigin() {
        SensorProfile profile = new SensorProfile(
                "chainfrost/" + TRUCK_ID + "/telematics/gps", "lat_lon_json", -180, 180, 100, 200, "GPS_RANDOM_WALK");
        SensorSimulator simulator = new SensorSimulator(TRUCK_ID, profile, noopExecutor(), r -> {}, new Random(11));

        double firstLat = simulator.nextValue();
        for (int i = 0; i < 100; i++) {
            simulator.nextValue();
        }
        double laterLat = simulator.nextValue();

        assertTrue(Math.abs(laterLat - firstLat) < 1.0, "GPS latitude drifted too far for a random walk");
        assertTrue(Math.abs(simulator.currentLongitude()) < 180.0);
    }

    @Test
    void dispatchCallbackFiresAtConfiguredRate() throws InterruptedException {
        SensorProfile profile = new SensorProfile(
                "chainfrost/" + TRUCK_ID + "/reefer/compressor_current", "amps", 0, 18, 20, 100, "RANDOM_WALK");
        List<SensorReading> dispatched = new CopyOnWriteArrayList<>();
        ScheduledExecutorService executor = Executors.newScheduledThreadPool(2);

        SensorSimulator simulator = new SensorSimulator(TRUCK_ID, profile, executor, dispatched::add, new Random(1));
        simulator.start();

        // Two dispatch cycles (100ms each) should have elapsed within 350ms.
        Thread.sleep(350);
        simulator.stop();
        executor.shutdownNow();

        assertTrue(dispatched.size() >= 2, "Expected at least 2 dispatched batches, got " + dispatched.size());
        for (SensorReading reading : dispatched) {
            assertEquals(TRUCK_ID, reading.truckId());
            assertEquals(profile.topic(), reading.topic());
        }
    }

    private ScheduledExecutorService noopExecutor() {
        // Tests call nextValue() directly and don't need real scheduling.
        ScheduledExecutorService executor = Executors.newSingleThreadScheduledExecutor();
        executorsToClose.add(executor);
        return executor;
    }
}
