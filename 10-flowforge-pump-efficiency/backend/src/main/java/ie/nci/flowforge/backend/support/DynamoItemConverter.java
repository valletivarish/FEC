package ie.nci.flowforge.backend.support;

import software.amazon.awssdk.services.dynamodb.model.AttributeValue;

import java.util.LinkedHashMap;
import java.util.Map;

/**
 * Converts between plain String-keyed maps (the fog-node event shape) and DynamoDB's
 * typed AttributeValue maps. Kept minimal since insight events only ever carry
 * strings and numbers, never nested lists/maps.
 */
public final class DynamoItemConverter {

    private DynamoItemConverter() {
    }

    public static Map<String, AttributeValue> toAttributeMap(Map<String, Object> source) {
        Map<String, AttributeValue> item = new LinkedHashMap<>();
        for (Map.Entry<String, Object> entry : source.entrySet()) {
            AttributeValue value = toAttributeValue(entry.getValue());
            if (value != null) {
                item.put(entry.getKey(), value);
            }
        }
        return item;
    }

    public static Map<String, Object> toJavaMap(Map<String, AttributeValue> item) {
        Map<String, Object> result = new LinkedHashMap<>();
        for (Map.Entry<String, AttributeValue> entry : item.entrySet()) {
            result.put(entry.getKey(), fromAttributeValue(entry.getValue()));
        }
        return result;
    }

    private static AttributeValue toAttributeValue(Object value) {
        if (value == null) {
            return AttributeValue.builder().nul(true).build();
        }
        if (value instanceof Number) {
            return AttributeValue.builder().n(value.toString()).build();
        }
        return AttributeValue.builder().s(String.valueOf(value)).build();
    }

    private static Object fromAttributeValue(AttributeValue value) {
        if (value.s() != null) {
            return value.s();
        }
        if (value.n() != null) {
            return value.n();
        }
        return null;
    }
}
