package binsight.fog.dispatch;

import org.junit.jupiter.api.Test;

import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.concurrent.atomic.AtomicInteger;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertTrue;

class BinSightEventDispatcherTest {

    // Subclass override of the protected HTTP seam lets tests force failures deterministically,
    // without depending on a real unreachable port or network flakiness.
    private static class CountingFailingDispatcher extends BinSightEventDispatcher {
        final AtomicInteger attemptCount = new AtomicInteger(0);

        CountingFailingDispatcher(String apiBaseUrl, int maxAttempts, long backoffMillis) {
            super(apiBaseUrl, maxAttempts, backoffMillis);
        }

        @Override
        protected boolean attemptPost(String url, Map<String, Object> event) {
            attemptCount.incrementAndGet();
            return false;
        }
    }

    private static class CountingSucceedingDispatcher extends BinSightEventDispatcher {
        final AtomicInteger attemptCount = new AtomicInteger(0);
        final List<String> urlsCalled = new java.util.ArrayList<>();

        CountingSucceedingDispatcher(String apiBaseUrl) {
            super(apiBaseUrl);
        }

        @Override
        protected boolean attemptPost(String url, Map<String, Object> event) {
            attemptCount.incrementAndGet();
            urlsCalled.add(url);
            return true;
        }
    }

    private Map<String, Object> criticalFireRiskEvent() {
        Map<String, Object> event = new HashMap<>();
        event.put("type", "fire_risk_alert");
        event.put("binId", "bin-01");
        event.put("riskStatus", "CRITICAL");
        event.put("riskScore", 85.0);
        event.put("timestamp", "2026-01-01T00:00:00Z");
        return event;
    }

    private Map<String, Object> watchFireRiskEvent() {
        Map<String, Object> event = new HashMap<>();
        event.put("type", "fire_risk_alert");
        event.put("binId", "bin-01");
        event.put("riskStatus", "WATCH");
        event.put("timestamp", "2026-01-01T00:00:00Z");
        return event;
    }

    private Map<String, Object> clusterVerdictEvent() {
        Map<String, Object> event = new HashMap<>();
        event.put("type", "cluster_verdict");
        event.put("binId", "bin-01");
        event.put("verdict", "INCONSISTENT");
        event.put("timestamp", "2026-01-01T00:00:00Z");
        return event;
    }

    @Test
    void criticalFireRisk_retriesUpToMaxAttempts_onRepeatedFailure() {
        CountingFailingDispatcher dispatcher = new CountingFailingDispatcher("http://unused", 3, 1);
        boolean result = dispatcher.dispatch(criticalFireRiskEvent());

        assertFalse(result);
        assertEquals(3, dispatcher.attemptCount.get());
    }

    @Test
    void criticalFireRisk_stopsRetrying_onceASucceedingAttemptOccurs() {
        Map<String, Object> event = criticalFireRiskEvent();
        AtomicInteger callCount = new AtomicInteger(0);
        BinSightEventDispatcher dispatcher = new BinSightEventDispatcher("http://unused", 3, 1) {
            @Override
            protected boolean attemptPost(String url, Map<String, Object> e) {
                return callCount.incrementAndGet() >= 2; // fails once, then succeeds
            }
        };

        boolean result = dispatcher.dispatch(event);
        assertTrue(result);
        assertEquals(2, callCount.get());
    }

    @Test
    void nonCriticalFireRisk_getsSingleAttempt_noRetry() {
        CountingFailingDispatcher dispatcher = new CountingFailingDispatcher("http://unused", 3, 1);
        boolean result = dispatcher.dispatch(watchFireRiskEvent());

        assertFalse(result);
        assertEquals(1, dispatcher.attemptCount.get());
    }

    @Test
    void clusterVerdict_getsSingleAttempt_evenOnFailure() {
        CountingFailingDispatcher dispatcher = new CountingFailingDispatcher("http://unused", 3, 1);
        boolean result = dispatcher.dispatch(clusterVerdictEvent());

        assertFalse(result);
        assertEquals(1, dispatcher.attemptCount.get());
    }

    @Test
    void finalFailure_appendsToFallbackQueue_retrievableViaDrain() {
        CountingFailingDispatcher dispatcher = new CountingFailingDispatcher("http://unused", 3, 1);
        Map<String, Object> event = criticalFireRiskEvent();
        dispatcher.dispatch(event);

        List<Map<String, Object>> fallback = dispatcher.drainFallback();
        assertEquals(1, fallback.size());
        assertEquals("bin-01", fallback.get(0).get("binId"));

        // drainFallback empties the queue.
        assertTrue(dispatcher.drainFallback().isEmpty());
    }

    @Test
    void success_doesNotAppendToFallbackQueue() {
        CountingSucceedingDispatcher dispatcher = new CountingSucceedingDispatcher("http://unused");
        dispatcher.dispatch(watchFireRiskEvent());

        assertTrue(dispatcher.drainFallback().isEmpty());
    }

    @Test
    void routesEachEventType_toItsSpecificPath() {
        CountingSucceedingDispatcher dispatcher = new CountingSucceedingDispatcher("http://api.example.com");

        dispatcher.dispatch(clusterVerdictEvent());
        dispatcher.dispatch(watchFireRiskEvent());

        Map<String, Object> workList = new HashMap<>();
        workList.put("type", "work_list_event");
        workList.put("depotId", "depot-01");
        dispatcher.dispatch(workList);

        assertEquals(List.of(
                "http://api.example.com/cluster-verdicts",
                "http://api.example.com/fire-risk",
                "http://api.example.com/work-list"
        ), dispatcher.urlsCalled);
    }

    @Test
    void unrecognisedEventType_failsWithoutAttemptingHttpCall() {
        CountingSucceedingDispatcher dispatcher = new CountingSucceedingDispatcher("http://unused");
        Map<String, Object> unknown = new HashMap<>();
        unknown.put("type", "something_else");

        boolean result = dispatcher.dispatch(unknown);

        assertFalse(result);
        assertEquals(0, dispatcher.attemptCount.get());
    }

    @Test
    void defaultConstructor_usesThreeAttemptsAndRealBackoffForCritical() {
        // Sanity check that the single-arg constructor still enforces the 3-attempt CRITICAL retry
        // contract, just with the real (larger) default backoff -- kept short via a tiny sleep budget
        // by using the failing subclass so the test doesn't depend on network access.
        class FailingDefaultDispatcher extends BinSightEventDispatcher {
            final AtomicInteger attempts = new AtomicInteger(0);

            FailingDefaultDispatcher(String apiBaseUrl) {
                super(apiBaseUrl);
            }

            @Override
            protected boolean attemptPost(String url, Map<String, Object> event) {
                attempts.incrementAndGet();
                return false;
            }
        }

        FailingDefaultDispatcher dispatcher = new FailingDefaultDispatcher("http://unused");
        dispatcher.dispatch(criticalFireRiskEvent());
        assertEquals(3, dispatcher.attempts.get());
    }
}
