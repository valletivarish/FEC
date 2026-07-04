"""Per-pond dissolved-oxygen crash detection: the highest-stakes fog node, so it stays self-contained."""
from collections import deque

WINDOW_SIZE = 5
RE_DISPATCH_TICKS = 30
MAX_RE_DISPATCHES = 10
WARM_WATER_THRESHOLD_C = 28.0
WARM_WATER_TIGHTEN_MG_L = 0.5
BASE_WARNING_THRESHOLD = 4.0
BASE_CRITICAL_THRESHOLD = 3.0
CRITICAL_RATE_OF_CHANGE = -0.5
PROBE_EXPOSED_WATER_LEVEL_CM = 30.0


def _linear_regression_slope(timestamps_min: list, values: list) -> float:
    """Slope of value vs time (minutes) via ordinary least squares over the window."""
    n = len(values)
    if n < 2:
        return 0.0
    mean_t = sum(timestamps_min) / n
    mean_v = sum(values) / n
    numerator = sum((t - mean_t) * (v - mean_v) for t, v in zip(timestamps_min, values))
    denominator = sum((t - mean_t) ** 2 for t in timestamps_min)
    if denominator == 0:
        return 0.0
    return numerator / denominator


class _PondState:
    def __init__(self):
        self.do_window = deque(maxlen=WINDOW_SIZE)
        self.latest_water_temperature = None
        self.latest_water_level = None
        self.active_stage = None
        self.ticks_since_dispatch = 0
        self.re_dispatch_count = 0


class LifeSupportFog:
    """Stage-1/Stage-2 hypoxia detection, temperature-compensated, with sensor-fault suppression."""

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

        if metric == "water-temperature":
            state.latest_water_temperature = reading["value"]
            return []
        if metric == "water-level":
            state.latest_water_level = reading["value"]
            return []
        if metric != "dissolved-oxygen":
            return []

        timestamp = reading["timestamp"]
        do_value = reading["value"]
        state.do_window.append((timestamp, do_value))

        rate_of_change = self._rate_of_change(state.do_window)

        # a probe sitting in air reads implausible DO values, not a real hypoxia event
        if state.latest_water_level is not None and state.latest_water_level < PROBE_EXPOSED_WATER_LEVEL_CM:
            return []

        warning_threshold = BASE_WARNING_THRESHOLD
        critical_threshold = BASE_CRITICAL_THRESHOLD
        if state.latest_water_temperature is not None and state.latest_water_temperature > WARM_WATER_THRESHOLD_C:
            warning_threshold += WARM_WATER_TIGHTEN_MG_L
            critical_threshold += WARM_WATER_TIGHTEN_MG_L

        if do_value < critical_threshold or rate_of_change < CRITICAL_RATE_OF_CHANGE:
            new_stage = "hypoxia_critical"
        elif do_value < warning_threshold:
            new_stage = "hypoxia_warning"
        else:
            new_stage = None

        return self._handle_stage_transition(
            state, new_stage, pond_id, do_value, rate_of_change, timestamp, state.latest_water_level
        )

    def _handle_stage_transition(
        self, state, new_stage, pond_id, do_value, rate_of_change, timestamp, water_level
    ) -> list[dict]:
        events = []

        if new_stage != state.active_stage:
            if new_stage is None:
                events.append(self._event(pond_id, "cleared", do_value, rate_of_change, timestamp, water_level))
            else:
                events.append(self._event(pond_id, new_stage, do_value, rate_of_change, timestamp, water_level))
            state.active_stage = new_stage
            state.ticks_since_dispatch = 0
            state.re_dispatch_count = 0
            return events

        if new_stage is None:
            return events

        state.ticks_since_dispatch += 1
        if state.ticks_since_dispatch >= RE_DISPATCH_TICKS and state.re_dispatch_count < MAX_RE_DISPATCHES:
            events.append(self._event(pond_id, new_stage, do_value, rate_of_change, timestamp, water_level))
            state.ticks_since_dispatch = 0
            state.re_dispatch_count += 1

        return events

    @staticmethod
    def _rate_of_change(window: deque) -> float:
        if len(window) < 2:
            return 0.0
        from datetime import datetime

        t0 = datetime.fromisoformat(window[0][0].replace("Z", "+00:00"))
        timestamps_min = []
        values = []
        for ts, val in window:
            t = datetime.fromisoformat(ts.replace("Z", "+00:00"))
            timestamps_min.append((t - t0).total_seconds() / 60.0)
            values.append(val)
        return _linear_regression_slope(timestamps_min, values)

    @staticmethod
    def _event(pond_id, stage, do_value, rate_of_change, timestamp, water_level) -> dict:
        return {
            "type": "life_support",
            "pond_id": pond_id,
            "stage": stage,
            "dissolved_oxygen": do_value,
            "rate_of_change": rate_of_change,
            # carried as context: the same reading this fog node used to decide whether a low
            # DO value is a real hypoxia event or an exposed probe artifact
            "water_level": water_level,
            "timestamp": timestamp,
        }
