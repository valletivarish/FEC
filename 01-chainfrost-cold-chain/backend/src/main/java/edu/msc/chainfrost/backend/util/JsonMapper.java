package edu.msc.chainfrost.backend.util;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.datatype.jsr310.JavaTimeModule;

/**
 * Single shared ObjectMapper instance so every handler serializes
 * Instant fields the same way.
 */
public final class JsonMapper {

    public static final ObjectMapper INSTANCE = new ObjectMapper()
            .registerModule(new JavaTimeModule());

    private JsonMapper() {
    }
}
