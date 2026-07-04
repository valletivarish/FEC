package edu.msc.floodwatch.backend.util;

import com.fasterxml.jackson.databind.ObjectMapper;

/**
 * Single shared ObjectMapper so both handlers serialize record/item shapes the same way.
 */
public final class JsonMapper {

    public static final ObjectMapper INSTANCE = new ObjectMapper();

    private JsonMapper() {
    }
}
