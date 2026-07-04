package edu.msc.chainfrost.fog.common;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.datatype.jsr310.JavaTimeModule;

/**
 * Single shared ObjectMapper instance so every fog node serializes Instant
 * fields the same way (ISO-8601 via JavaTimeModule, not epoch arrays).
 */
public final class JsonSupport {

    public static final ObjectMapper MAPPER = new ObjectMapper().registerModule(new JavaTimeModule());

    private JsonSupport() {
    }
}
