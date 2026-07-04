package edu.msc.chainfrost.fog.reeferhealthfog;

import java.time.Instant;
import java.util.Map;

/** Result of a single correlation check: which fault (if any) is currently active. */
public record FaultFinding(FaultType faultType, Instant windowStart, Map<String, Object> details) {
}
