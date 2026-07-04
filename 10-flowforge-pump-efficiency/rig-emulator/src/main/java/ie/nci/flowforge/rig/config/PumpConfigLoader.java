package ie.nci.flowforge.rig.config;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.dataformat.yaml.YAMLFactory;

import java.io.IOException;
import java.io.InputStream;
import java.nio.file.Files;
import java.nio.file.Path;

/** Loads a per-pump YAML file; classpath lookup covers packaged jars, path lookup covers local dev edits. */
public final class PumpConfigLoader {

    private final ObjectMapper yamlMapper = new ObjectMapper(new YAMLFactory());

    public PumpConfig loadFromClasspath(String resourceName) {
        try (InputStream in = getClass().getClassLoader().getResourceAsStream(resourceName)) {
            if (in == null) {
                throw new IllegalArgumentException("Config not found on classpath: " + resourceName);
            }
            return yamlMapper.readValue(in, PumpConfig.class);
        } catch (IOException e) {
            throw new IllegalStateException("Failed to parse pump config: " + resourceName, e);
        }
    }

    public PumpConfig loadFromPath(Path path) {
        try {
            return yamlMapper.readValue(Files.newInputStream(path), PumpConfig.class);
        } catch (IOException e) {
            throw new IllegalStateException("Failed to parse pump config: " + path, e);
        }
    }
}
