package edu.msc.chainfrost.reefersim.config;

import org.yaml.snakeyaml.Yaml;

import java.io.InputStream;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.function.Function;

/**
 * Parses sensor-profiles.yaml into SensorProfile records, applying per-truck
 * topic substitution and CHAINFROST_<KEY>_FREQUENCY_MS / _DISPATCH_MS overrides.
 */
public class FleetConfigLoader {

    private static final String DEFAULT_RESOURCE = "sensor-profiles.yaml";

    private final Function<String, String> envLookup;

    public FleetConfigLoader() {
        this(System::getenv);
    }

    // Allows tests to inject a fake environment without touching real process env.
    public FleetConfigLoader(Function<String, String> envLookup) {
        this.envLookup = envLookup;
    }

    public List<SensorProfile> loadForTruck(String truckId) {
        return loadForTruck(truckId, DEFAULT_RESOURCE);
    }

    @SuppressWarnings("unchecked")
    public List<SensorProfile> loadForTruck(String truckId, String resourcePath) {
        List<SensorProfile> profiles = new ArrayList<>();
        Yaml yaml = new Yaml();

        try (InputStream in = getClass().getClassLoader().getResourceAsStream(resourcePath)) {
            if (in == null) {
                throw new IllegalArgumentException("sensor-profiles resource not found: " + resourcePath);
            }
            Map<String, Object> root = yaml.load(in);
            List<Map<String, Object>> sensors = (List<Map<String, Object>>) root.get("sensors");

            for (Map<String, Object> entry : sensors) {
                String key = (String) entry.get("key");
                String topicTemplate = (String) entry.get("topic");
                String topic = topicTemplate.replace("{truckId}", truckId);
                String unit = (String) entry.get("unit");
                double min = ((Number) entry.get("min")).doubleValue();
                double max = ((Number) entry.get("max")).doubleValue();
                long sampleFrequencyMs = resolveLong(key, "FREQUENCY_MS", ((Number) entry.get("sampleFrequencyMs")).longValue());
                long dispatchRateMs = resolveLong(key, "DISPATCH_MS", ((Number) entry.get("dispatchRateMs")).longValue());
                String valueModel = (String) entry.get("valueModel");

                profiles.add(new SensorProfile(topic, unit, min, max, sampleFrequencyMs, dispatchRateMs, valueModel));
            }
        } catch (java.io.IOException e) {
            throw new IllegalStateException("Failed to read sensor-profiles resource: " + resourcePath, e);
        }

        return profiles;
    }

    private long resolveLong(String sensorKey, String suffix, long defaultValue) {
        String envVar = "CHAINFROST_" + sensorKey + "_" + suffix;
        String override = envLookup.apply(envVar);
        return override != null ? Long.parseLong(override.trim()) : defaultValue;
    }
}
