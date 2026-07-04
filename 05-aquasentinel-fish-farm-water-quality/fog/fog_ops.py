"""Overfeeding inference: correlates feeder load with water-chemistry drift over a 6h rolling window."""
from collections import deque
from datetime import datetime, timedelta

WINDOW_HOURS = 6
CONFIDENCE_STEP = 0.25
DISPATCH_THRESHOLD = 0.5


def _parse_ts(timestamp: str) -> datetime:
    return datetime.fromisoformat(timestamp.replace("Z", "+00:00"))


def _slope(readings: list) -> float:
    """OLS slope of value vs elapsed minutes; readings are (timestamp, value) tuples, oldest first."""
    if len(readings) < 2:
        return 0.0
    t0 = _parse_ts(readings[0][0])
    xs = [( _parse_ts(ts) - t0).total_seconds() / 60.0 for ts, _ in readings]
    ys = [v for _, v in readings]
    n = len(ys)
    mean_x = sum(xs) / n
    mean_y = sum(ys) / n
    numerator = sum((x - mean_x) * (y - mean_y) for x, y in zip(xs, ys))
    denominator = sum((x - mean_x) ** 2 for x in xs)
    if denominator == 0:
        return 0.0
    return numerator / denominator


def _median(values: list) -> float:
    ordered = sorted(values)
    n = len(ordered)
    mid = n // 2
    if n % 2 == 0:
        return (ordered[mid - 1] + ordered[mid]) / 2.0
    return ordered[mid]


class _PondState:
    def __init__(self):
        self.feeder_readings = deque()
        self.ammonia_readings = deque()
        self.turbidity_readings = deque()
        self.orp_readings = deque()
        self.above_threshold = False


class OpsFog:
    """Multi-signal overfeeding correlation -- never trips on a single metric alone."""

    def __init__(self):
        self._ponds: dict[str, _PondState] = {}

    def _state_for(self, pond_id: str) -> _PondState:
        if pond_id not in self._ponds:
            self._ponds[pond_id] = _PondState()
        return self._ponds[pond_id]

    def on_reading(self, reading: dict) -> list[dict]:
        pond_id = reading["pondId"]
        metric = reading["metric"]
        state = self._state_for(pond_id)

        metric_to_deque = {
            "feeder-load-cell": state.feeder_readings,
            "ammonia-nh3-total": state.ammonia_readings,
            "turbidity": state.turbidity_readings,
            "orp": state.orp_readings,
        }
        target = metric_to_deque.get(metric)
        if target is None:
            return []

        timestamp = reading["timestamp"]
        target.append((timestamp, reading["value"]))
        self._trim_to_window(target, timestamp)

        confidence, signals = self._compute_confidence(state)

        events = []
        is_above = confidence >= DISPATCH_THRESHOLD
        if is_above and not state.above_threshold:
            events.append(
                {
                    "type": "ops_feed_correlation",
                    "pond_id": pond_id,
                    "overfeeding_confidence": confidence,
                    "contributing_signals": signals,
                    # the 4 raw signals behind this confidence score, carried as context
                    "feeder_load_cell": self._latest(state.feeder_readings),
                    "ammonia_nh3_total": self._latest(state.ammonia_readings),
                    "turbidity": self._latest(state.turbidity_readings),
                    "orp": self._latest(state.orp_readings),
                    "timestamp": timestamp,
                }
            )
        state.above_threshold = is_above
        return events

    @staticmethod
    def _latest(window: deque):
        return window[-1][1] if window else None

    @staticmethod
    def _trim_to_window(window: deque, latest_timestamp: str):
        cutoff = _parse_ts(latest_timestamp) - timedelta(hours=WINDOW_HOURS)
        while window and _parse_ts(window[0][0]) < cutoff:
            window.popleft()

    @staticmethod
    def _compute_confidence(state: _PondState):
        signals = []
        confidence = 0.0

        if len(state.feeder_readings) >= 2:
            values = [v for _, v in state.feeder_readings]
            median = _median(values)
            latest = values[-1]
            if median > 0 and latest > median * 1.2:
                confidence += CONFIDENCE_STEP
                signals.append("feeder_load_above_median")

        if _slope(list(state.ammonia_readings)) > 0:
            confidence += CONFIDENCE_STEP
            signals.append("ammonia_rising")

        if _slope(list(state.turbidity_readings)) > 0:
            confidence += CONFIDENCE_STEP
            signals.append("turbidity_rising")

        if _slope(list(state.orp_readings)) < 0:
            confidence += CONFIDENCE_STEP
            signals.append("orp_falling")

        return confidence, signals
