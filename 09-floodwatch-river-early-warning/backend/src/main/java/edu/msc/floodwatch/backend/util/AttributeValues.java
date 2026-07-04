package edu.msc.floodwatch.backend.util;

import software.amazon.awssdk.services.dynamodb.model.AttributeValue;

import java.util.LinkedHashMap;
import java.util.Map;

/**
 * Converts between plain Java values (as parsed from event JSON) and DynamoDB's
 * typed AttributeValue wrapper, so handlers don't repeat this branching inline.
 */
public final class AttributeValues {

    private AttributeValues() {
    }

    public static AttributeValue from(Object value) {
        if (value == null) {
            return AttributeValue.builder().nul(true).build();
        }
        if (value instanceof Boolean bool) {
            return AttributeValue.builder().bool(bool).build();
        }
        if (value instanceof Number number) {
            return AttributeValue.builder().n(number.toString()).build();
        }
        return AttributeValue.builder().s(String.valueOf(value)).build();
    }

    public static Map<String, AttributeValue> fromMap(Map<String, Object> item) {
        Map<String, AttributeValue> attributes = new LinkedHashMap<>();
        item.forEach((key, value) -> attributes.put(key, from(value)));
        return attributes;
    }

    public static Object toJavaValue(AttributeValue attributeValue) {
        if (attributeValue.nul() != null && attributeValue.nul()) {
            return null;
        }
        if (attributeValue.bool() != null) {
            return attributeValue.bool();
        }
        if (attributeValue.n() != null) {
            return Double.valueOf(attributeValue.n());
        }
        if (attributeValue.s() != null) {
            return attributeValue.s();
        }
        return null;
    }

    public static Map<String, Object> toJavaMap(Map<String, AttributeValue> item) {
        Map<String, Object> result = new LinkedHashMap<>();
        item.forEach((key, value) -> result.put(key, toJavaValue(value)));
        return result;
    }
}
