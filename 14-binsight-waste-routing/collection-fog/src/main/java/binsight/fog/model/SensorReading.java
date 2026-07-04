package binsight.fog.model;

/**
 * In-memory representation of one MQTT sensor message, decoupled from the wire JSON
 * so fog nodes never depend on Jackson types directly.
 */
public final class SensorReading {

    private final String entityId;
    private final String entityType;
    private final String metric;
    private final Object value;
    private final String unit;
    private final String timestamp;

    public SensorReading(String entityId, String entityType, String metric, Object value, String unit, String timestamp) {
        this.entityId = entityId;
        this.entityType = entityType;
        this.metric = metric;
        this.value = value;
        this.unit = unit;
        this.timestamp = timestamp;
    }

    public String getEntityId() {
        return entityId;
    }

    public String getEntityType() {
        return entityType;
    }

    public String getMetric() {
        return metric;
    }

    public Object getValue() {
        return value;
    }

    public String getUnit() {
        return unit;
    }

    public String getTimestamp() {
        return timestamp;
    }

    public double numericValue() {
        return ((Number) value).doubleValue();
    }

    public String stringValue() {
        return (String) value;
    }
}
