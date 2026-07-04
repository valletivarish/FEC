package binsight.backend.support;

import software.amazon.awssdk.services.dynamodb.model.AttributeValue;

import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

/**
 * Converts between plain Java maps (the fog-node event shape, parsed from JSON) and
 * DynamoDB's typed AttributeValue maps. Recursive so nested lists/maps (e.g. work_list_event's
 * items[]) round-trip correctly, not just flat scalar events.
 */
public final class DynamoItemConverter {

    private DynamoItemConverter() {
    }

    public static Map<String, AttributeValue> toAttributeMap(Map<String, Object> source) {
        Map<String, AttributeValue> item = new LinkedHashMap<>();
        for (Map.Entry<String, Object> entry : source.entrySet()) {
            item.put(entry.getKey(), toAttributeValue(entry.getValue()));
        }
        return item;
    }

    @SuppressWarnings("unchecked")
    public static AttributeValue toAttributeValue(Object value) {
        if (value == null) {
            return AttributeValue.builder().nul(true).build();
        }
        if (value instanceof Number) {
            return AttributeValue.builder().n(value.toString()).build();
        }
        if (value instanceof Boolean bool) {
            return AttributeValue.builder().bool(bool).build();
        }
        if (value instanceof Map) {
            Map<String, AttributeValue> nested = new LinkedHashMap<>();
            for (Map.Entry<String, Object> entry : ((Map<String, Object>) value).entrySet()) {
                nested.put(entry.getKey(), toAttributeValue(entry.getValue()));
            }
            return AttributeValue.builder().m(nested).build();
        }
        if (value instanceof List) {
            List<AttributeValue> nested = new ArrayList<>();
            for (Object element : (List<Object>) value) {
                nested.add(toAttributeValue(element));
            }
            return AttributeValue.builder().l(nested).build();
        }
        return AttributeValue.builder().s(String.valueOf(value)).build();
    }

    public static Map<String, Object> toJavaMap(Map<String, AttributeValue> item) {
        Map<String, Object> result = new LinkedHashMap<>();
        for (Map.Entry<String, AttributeValue> entry : item.entrySet()) {
            result.put(entry.getKey(), fromAttributeValue(entry.getValue()));
        }
        return result;
    }

    public static Object fromAttributeValue(AttributeValue value) {
        if (value == null || Boolean.TRUE.equals(value.nul())) {
            return null;
        }
        if (value.s() != null) {
            return value.s();
        }
        if (value.n() != null) {
            return value.n();
        }
        if (value.bool() != null) {
            return value.bool();
        }
        if (value.hasM()) {
            Map<String, Object> nested = new LinkedHashMap<>();
            for (Map.Entry<String, AttributeValue> entry : value.m().entrySet()) {
                nested.put(entry.getKey(), fromAttributeValue(entry.getValue()));
            }
            return nested;
        }
        if (value.hasL()) {
            List<Object> nested = new ArrayList<>();
            for (AttributeValue element : value.l()) {
                nested.add(fromAttributeValue(element));
            }
            return nested;
        }
        return null;
    }
}
