package ie.nci.flowforge.rig.config;

import org.junit.jupiter.api.Test;

import java.util.Map;
import java.util.stream.Collectors;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertTrue;

class PumpConfigLoaderTest {

    private final PumpConfigLoader loader = new PumpConfigLoader();

    @Test
    void loadsPumpIdAndBrokerUrlFromYaml() {
        PumpConfig config = loader.loadFromClasspath("pump-01.yaml");

        assertEquals("pump-01", config.getPumpId());
        assertEquals("tcp://localhost:1883", config.getMqttBrokerUrl());
        assertEquals(10, config.getSensors().size());
    }

    @Test
    void appliesIndependentSampleAndDispatchIntervalsPerSensor() {
        PumpConfig config = loader.loadFromClasspath("pump-01.yaml");
        Map<String, SensorScheduleConfig> byMetric = config.getSensors().stream()
                .collect(Collectors.toMap(SensorScheduleConfig::getMetric, s -> s));

        SensorScheduleConfig vibration = byMetric.get("vibration");
        SensorScheduleConfig sealLeak = byMetric.get("seal-leak");

        assertEquals(2, vibration.getSampleIntervalSeconds());
        assertEquals(2, vibration.getDispatchIntervalSeconds());
        assertEquals(10, sealLeak.getSampleIntervalSeconds());
        assertEquals(10, sealLeak.getDispatchIntervalSeconds());
        assertTrue(vibration.getSampleIntervalSeconds() != sealLeak.getSampleIntervalSeconds());
    }

    @Test
    void differentPumpsCanHaveDifferentDispatchCadenceForTheSameMetric() {
        PumpConfig pump01 = loader.loadFromClasspath("pump-01.yaml");
        PumpConfig pump02 = loader.loadFromClasspath("pump-02.yaml");

        int pump01VibrationDispatch = dispatchIntervalFor(pump01, "vibration");
        int pump02VibrationDispatch = dispatchIntervalFor(pump02, "vibration");

        assertTrue(pump01VibrationDispatch != pump02VibrationDispatch,
                "expected pump-01 and pump-02 to configure vibration dispatch independently");
    }

    private int dispatchIntervalFor(PumpConfig config, String metric) {
        return config.getSensors().stream()
                .filter(s -> s.getMetric().equals(metric))
                .findFirst()
                .orElseThrow()
                .getDispatchIntervalSeconds();
    }
}
