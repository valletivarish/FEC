package binsight.emitters.config;

import org.yaml.snakeyaml.Yaml;

import java.io.IOException;
import java.io.InputStream;
import java.io.UncheckedIOException;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

/** Reads a per-entity YAML config file from the classpath into a SensorProfile. */
public class SensorProfileLoader {

    @SuppressWarnings("unchecked")
    public SensorProfile load(String entityId) {
        String resourcePath = entityId + ".yaml";
        try (InputStream in = getClass().getClassLoader().getResourceAsStream(resourcePath)) {
            if (in == null) {
                throw new IllegalArgumentException("No sensor profile found on classpath: " + resourcePath);
            }
            Yaml yaml = new Yaml();
            Map<String, Object> root = yaml.load(in);

            String resolvedEntityId = (String) root.getOrDefault("entityId", entityId);
            String entityType = (String) root.get("entityType");

            List<Map<String, Object>> metrics = (List<Map<String, Object>>) root.get("metrics");
            Map<String, MetricSchedule> schedules = new LinkedHashMap<>();
            for (Map<String, Object> metricConfig : metrics) {
                String metric = (String) metricConfig.get("name");
                int sampleIntervalSeconds = ((Number) metricConfig.get("sampleIntervalSeconds")).intValue();
                int dispatchIntervalSeconds = ((Number) metricConfig.get("dispatchIntervalSeconds")).intValue();
                schedules.put(metric, new MetricSchedule(metric, sampleIntervalSeconds, dispatchIntervalSeconds));
            }

            return new SensorProfile(resolvedEntityId, entityType, schedules);
        } catch (IOException e) {
            throw new UncheckedIOException("Failed to load sensor profile: " + resourcePath, e);
        }
    }
}
