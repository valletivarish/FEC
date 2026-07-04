package edu.msc.floodwatch.gaugesim.config;

import org.junit.jupiter.api.Test;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertNotNull;

class ReachGaugeConfigLoaderTest {

    private final ReachGaugeConfigLoader loader = new ReachGaugeConfigLoader();

    @Test
    void loadsReachIdAndBrokerUrlFromYaml() {
        ReachGaugeConfig config = loader.loadFromClasspath("reach-upper.yaml");

        assertEquals("reach-upper", config.getReachId());
        assertNotNull(config.getMqttBrokerUrl());
    }

    @Test
    void appliesIndependentSampleAndDispatchIntervalsPerSensor() {
        ReachGaugeConfig config = loader.loadFromClasspath("reach-upper.yaml");

        SensorScheduleConfig riverLevel = config.getSensors().get("river-level");
        SensorScheduleConfig soilSaturation = config.getSensors().get("soil-saturation");
        SensorScheduleConfig dissolvedOxygen = config.getSensors().get("dissolved-oxygen");

        assertEquals(5, riverLevel.getSampleIntervalSeconds());
        assertEquals(5, riverLevel.getDispatchIntervalSeconds());

        assertEquals(30, soilSaturation.getSampleIntervalSeconds());
        assertEquals(30, soilSaturation.getDispatchIntervalSeconds());

        // dissolved-oxygen samples every 20s but only dispatches every 40s - independent cadences.
        assertEquals(20, dissolvedOxygen.getSampleIntervalSeconds());
        assertEquals(40, dissolvedOxygen.getDispatchIntervalSeconds());
    }

    @Test
    void loadsAllTenSensorsForEachReach() {
        for (String resource : new String[] {"reach-upper.yaml", "reach-mid.yaml", "reach-lower.yaml"}) {
            ReachGaugeConfig config = loader.loadFromClasspath(resource);
            assertEquals(10, config.getSensors().size());
        }
    }

    @Test
    void distinguishesReachIdsAcrossTheThreeConfigFiles() {
        assertEquals("reach-upper", loader.loadFromClasspath("reach-upper.yaml").getReachId());
        assertEquals("reach-mid", loader.loadFromClasspath("reach-mid.yaml").getReachId());
        assertEquals("reach-lower", loader.loadFromClasspath("reach-lower.yaml").getReachId());
    }
}
