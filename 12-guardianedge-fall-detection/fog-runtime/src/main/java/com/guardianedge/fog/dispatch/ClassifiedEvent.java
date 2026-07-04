package com.guardianedge.fog.dispatch;

import java.util.Map;

/** Typed wrapper around a fog node's raw event map, used for internal runtime wiring. */
public class ClassifiedEvent {

    private final String type;
    private final Map<String, Object> payload;

    public ClassifiedEvent(String type, Map<String, Object> payload) {
        this.type = type;
        this.payload = payload;
    }

    public String getType() {
        return type;
    }

    public Map<String, Object> getPayload() {
        return payload;
    }
}
