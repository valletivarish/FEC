package ie.nci.flowforge.fogcommon;

import java.util.ArrayList;
import java.util.List;
import java.util.Map;

/**
 * Records dispatched events in memory so tests can assert shapes without a real HTTP call.
 */
public class FakeInsightDispatcher extends InsightDispatcher {

    private final List<Map<String, Object>> dispatched = new ArrayList<>();

    public FakeInsightDispatcher() {
        super("http://unused.invalid");
    }

    @Override
    public boolean dispatch(Map<String, Object> event) {
        dispatched.add(event);
        return true;
    }

    public List<Map<String, Object>> getDispatched() {
        return dispatched;
    }
}
