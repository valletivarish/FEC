package edu.msc.floodwatch.gaugesim.config;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.dataformat.yaml.YAMLFactory;

import java.io.IOException;
import java.io.InputStream;

/** Loads a per-reach YAML config from the classpath (packaged) or an external filesystem path. */
public class ReachGaugeConfigLoader {

    private final ObjectMapper yamlMapper = new ObjectMapper(new YAMLFactory());

    public ReachGaugeConfig loadFromClasspath(String resourceName) {
        try (InputStream in = getClass().getClassLoader().getResourceAsStream(resourceName)) {
            if (in == null) {
                throw new IllegalArgumentException("Config resource not found: " + resourceName);
            }
            return yamlMapper.readValue(in, ReachGaugeConfig.class);
        } catch (IOException e) {
            throw new IllegalStateException("Failed to parse reach config: " + resourceName, e);
        }
    }

    public ReachGaugeConfig loadFromFile(String path) {
        try (InputStream in = new java.io.FileInputStream(path)) {
            return yamlMapper.readValue(in, ReachGaugeConfig.class);
        } catch (IOException e) {
            throw new IllegalStateException("Failed to parse reach config file: " + path, e);
        }
    }
}
