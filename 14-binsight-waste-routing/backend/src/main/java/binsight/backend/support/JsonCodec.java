package binsight.backend.support;

import com.fasterxml.jackson.databind.ObjectMapper;

/** Single shared Jackson mapper so every handler serializes/deserializes consistently. */
public final class JsonCodec {

    public static final ObjectMapper MAPPER = new ObjectMapper();

    private JsonCodec() {
    }
}
