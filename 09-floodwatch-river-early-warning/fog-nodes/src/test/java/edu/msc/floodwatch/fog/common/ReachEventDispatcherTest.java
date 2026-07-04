package edu.msc.floodwatch.fog.common;

import org.junit.jupiter.api.Test;

import java.util.HashMap;
import java.util.List;
import java.util.Map;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertTrue;

class ReachEventDispatcherTest {

    @Test
    void unreachableHostReturnsFalseAndQueuesToFallbackInsteadOfThrowing() {
        // port 1 is a reserved/unassigned port that will refuse the connection immediately
        ReachEventDispatcher dispatcher = new ReachEventDispatcher("http://127.0.0.1:1");
        Map<String, Object> event = new HashMap<>();
        event.put("type", "hydro_event");
        event.put("reachId", "reach-upper");

        boolean result = dispatcher.dispatch(event);

        assertFalse(result);
        List<Map<String, Object>> fallback = dispatcher.drainFallback();
        assertEquals(1, fallback.size());
        assertEquals("reach-upper", fallback.get(0).get("reachId"));
    }

    @Test
    void drainFallbackClearsTheQueue() {
        ReachEventDispatcher dispatcher = new ReachEventDispatcher("http://127.0.0.1:1");
        Map<String, Object> event = new HashMap<>();
        event.put("type", "meteo_event");
        dispatcher.dispatch(event);

        assertEquals(1, dispatcher.drainFallback().size());
        assertTrue(dispatcher.drainFallback().isEmpty());
    }

    @Test
    void isSubclassableForTestDoubles() {
        ReachEventDispatcher fake = new ReachEventDispatcher("http://unused") {
            @Override
            public boolean dispatch(Map<String, Object> event) {
                return true;
            }
        };

        assertTrue(fake.dispatch(new HashMap<>()));
    }
}
