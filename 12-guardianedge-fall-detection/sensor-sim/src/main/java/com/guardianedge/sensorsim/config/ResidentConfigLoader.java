package com.guardianedge.sensorsim.config;

import java.io.IOException;
import java.io.InputStream;
import java.io.UncheckedIOException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.LinkedHashMap;
import java.util.Map;
import org.yaml.snakeyaml.LoaderOptions;
import org.yaml.snakeyaml.Yaml;
import org.yaml.snakeyaml.constructor.Constructor;

/** Loads a per-resident YAML schedule file into a typed ResidentSensorConfig. */
public final class ResidentConfigLoader {

    private final Yaml yaml;

    public ResidentConfigLoader() {
        LoaderOptions options = new LoaderOptions();
        this.yaml = new Yaml(new Constructor(ResidentSensorConfig.class, options));
    }

    /** Reads a resident config from the sensor-sim classpath resources (e.g. "resident-01.yaml"). */
    public ResidentSensorConfig loadFromClasspath(String resourceName) {
        try (InputStream stream = getClass().getClassLoader().getResourceAsStream(resourceName)) {
            if (stream == null) {
                throw new IllegalArgumentException("Resident config not found on classpath: " + resourceName);
            }
            return parse(stream);
        } catch (IOException e) {
            throw new UncheckedIOException("Failed to close resident config stream " + resourceName, e);
        }
    }

    /** Reads a resident config from an arbitrary filesystem path, for operators overriding defaults. */
    public ResidentSensorConfig loadFromPath(Path path) {
        try (InputStream stream = Files.newInputStream(path)) {
            return parse(stream);
        } catch (IOException e) {
            throw new UncheckedIOException("Failed to read resident config at " + path, e);
        }
    }

    private ResidentSensorConfig parse(InputStream stream) {
        ResidentSensorConfig config = yaml.load(stream);
        if (config == null || config.getMetrics() == null) {
            return new ResidentSensorConfig();
        }
        // SnakeYAML materializes nested maps eagerly, but normalize into a fresh LinkedHashMap for predictable iteration in tests.
        Map<String, MetricSchedule> normalized = new LinkedHashMap<>(config.getMetrics());
        config.setMetrics(normalized);
        return config;
    }
}
