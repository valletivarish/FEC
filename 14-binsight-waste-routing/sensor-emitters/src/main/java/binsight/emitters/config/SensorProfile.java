package binsight.emitters.config;

import java.util.Collections;
import java.util.LinkedHashMap;
import java.util.Map;

/** Resolved config for one entity: its id/type plus a schedule per metric it emits. */
public class SensorProfile {

    private final String entityId;
    private final String entityType;
    private final Map<String, MetricSchedule> schedulesByMetric;

    public SensorProfile(String entityId, String entityType, Map<String, MetricSchedule> schedulesByMetric) {
        this.entityId = entityId;
        this.entityType = entityType;
        this.schedulesByMetric = new LinkedHashMap<>(schedulesByMetric);
    }

    public String getEntityId() {
        return entityId;
    }

    public String getEntityType() {
        return entityType;
    }

    public Map<String, MetricSchedule> getSchedulesByMetric() {
        return Collections.unmodifiableMap(schedulesByMetric);
    }

    public MetricSchedule getSchedule(String metric) {
        return schedulesByMetric.get(metric);
    }
}
