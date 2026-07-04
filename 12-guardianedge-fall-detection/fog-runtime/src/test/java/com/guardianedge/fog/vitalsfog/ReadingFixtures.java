package com.guardianedge.fog.vitalsfog;

import java.util.HashMap;
import java.util.Map;

final class ReadingFixtures {

    private ReadingFixtures() {
    }

    static Map<String, Object> reading(String residentId, String metric, double value, String timestamp) {
        Map<String, Object> reading = new HashMap<>();
        reading.put("residentId", residentId);
        reading.put("metric", metric);
        reading.put("value", value);
        reading.put("unit", "n/a");
        reading.put("timestamp", timestamp);
        return reading;
    }
}
