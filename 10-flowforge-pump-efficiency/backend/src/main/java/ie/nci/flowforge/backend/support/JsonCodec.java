package ie.nci.flowforge.backend.support;

import com.fasterxml.jackson.databind.ObjectMapper;

/** Single shared mapper instance so every handler serializes/deserializes consistently. */
public final class JsonCodec {

    public static final ObjectMapper MAPPER = new ObjectMapper();

    private JsonCodec() {
    }
}
