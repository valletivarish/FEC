package edu.msc.chainfrost.reefersim.config;

import org.junit.jupiter.api.Test;

import java.util.List;
import java.util.Map;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;

class FleetConfigLoaderTest {

    private static final String TRUCK_ID = "truck-01";

    @Test
    void parsesAllTenSensorTopicsFromYaml() {
        FleetConfigLoader loader = new FleetConfigLoader(key -> null);
        List<SensorProfile> profiles = loader.loadForTruck(TRUCK_ID);

        assertEquals(10, profiles.size());
        assertTrue(profiles.stream().anyMatch(p -> p.topic().equals("chainfrost/" + TRUCK_ID + "/reefer/zone1/temp")));
        assertTrue(profiles.stream().anyMatch(p -> p.topic().equals("chainfrost/" + TRUCK_ID + "/telematics/gps")));
        assertTrue(profiles.stream().anyMatch(p -> p.topic().equals("chainfrost/" + TRUCK_ID + "/reefer/battery_level")));
    }

    @Test
    void envOverrideTakesPrecedenceOverYamlDefault() {
        Map<String, String> fakeEnv = Map.of(
                "CHAINFROST_ZONE1_TEMP_FREQUENCY_MS", "1234",
                "CHAINFROST_ZONE1_TEMP_DISPATCH_MS", "5678");
        FleetConfigLoader loader = new FleetConfigLoader(fakeEnv::get);

        List<SensorProfile> profiles = loader.loadForTruck(TRUCK_ID);
        SensorProfile zone1 = profiles.stream()
                .filter(p -> p.topic().equals("chainfrost/" + TRUCK_ID + "/reefer/zone1/temp"))
                .findFirst()
                .orElseThrow();

        assertEquals(1234L, zone1.sampleFrequencyMs());
        assertEquals(5678L, zone1.dispatchRateMs());
    }

    @Test
    void dispatchRateLessThanSampleFrequencyThrows() {
        IllegalArgumentException ex = assertThrows(IllegalArgumentException.class,
                () -> new SensorProfile("chainfrost/truck-01/reefer/zone1/temp", "celsius", -30, 10,
                        10000, 5000, "RANDOM_WALK"));

        assertTrue(ex.getMessage().contains("dispatchRateMs"));
    }

    @Test
    void envOverrideAppliesOnlyToMatchingSensorKey() {
        Map<String, String> fakeEnv = Map.of("CHAINFROST_ZONE1_TEMP_FREQUENCY_MS", "9999");
        FleetConfigLoader loader = new FleetConfigLoader(fakeEnv::get);

        List<SensorProfile> profiles = loader.loadForTruck(TRUCK_ID);
        SensorProfile zone2 = profiles.stream()
                .filter(p -> p.topic().equals("chainfrost/" + TRUCK_ID + "/reefer/zone2/temp"))
                .findFirst()
                .orElseThrow();

        assertEquals(5000L, zone2.sampleFrequencyMs());
    }
}
