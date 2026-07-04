"""EWMA-based rate-of-rise and absolute-limit detection for co2, co, no2."""
from __future__ import annotations

from collections import defaultdict
from datetime import datetime
from typing import Optional

from advisory import Advisory
from dispatcher import AdvisoryDispatcher
from node_stats import NodeStats

GAS_SENSORS = {"co2", "co", "no2"}
_EWMA_ALPHA = 0.3

# Sustained rate-of-rise threshold, in sensor units per minute.
_RATE_THRESHOLDS = {
    "co2": 50.0,
    "co": 3.0,
    "no2": 15.0,
}

# Absolute safety limits; crossing these fires regardless of trend.
_ABSOLUTE_LIMITS = {
    "co": 9.0,
    "no2": 100.0,
}

_RATE_SUSTAIN_SAMPLES = 2


class _ZoneGasState:
    """Per-zone, per-gas EWMA and consecutive-breach bookkeeping."""

    def __init__(self) -> None:
        self.ewma: Optional[float] = None
        self.last_timestamp: Optional[datetime] = None
        self.consecutive_breaches = 0


def _parse_timestamp(timestamp: str) -> datetime:
    return datetime.fromisoformat(timestamp.replace("Z", "+00:00"))


class FogGases:
    """Tracks EWMA trend and absolute limits per zone/gas, coalescing dual triggers."""

    def __init__(self, dispatcher: AdvisoryDispatcher, stats: Optional[NodeStats] = None) -> None:
        self._dispatcher = dispatcher
        self.stats = stats or NodeStats("FogGases")
        self._state: dict[tuple[str, str], _ZoneGasState] = defaultdict(_ZoneGasState)

    def handle_reading(self, reading: dict) -> None:
        sensor = reading["topic"]
        if sensor not in GAS_SENSORS:
            return

        self.stats.record_received()

        zone_id = reading["zone_id"]
        value = float(reading["value"])
        timestamp = reading["timestamp"]
        key = (zone_id, sensor)
        state = self._state[key]

        rate_per_min = self._update_ewma(state, value, timestamp)

        advisory_types: list[str] = []
        details: dict[str, object] = {}

        rate_threshold = _RATE_THRESHOLDS.get(sensor)
        if rate_threshold is not None and rate_per_min is not None:
            if rate_per_min > rate_threshold:
                state.consecutive_breaches += 1
            else:
                state.consecutive_breaches = 0
            if state.consecutive_breaches >= _RATE_SUSTAIN_SAMPLES:
                advisory_types.append("rate_of_rise")
                details["rate_per_min"] = rate_per_min

        limit = _ABSOLUTE_LIMITS.get(sensor)
        if limit is not None and value > limit:
            advisory_types.append("limit_exceeded")
            details["limit"] = limit

        if not advisory_types:
            self.stats.record_processed()
            return

        self.stats.record_processed()
        # Coalesce both triggers into a single HTTP call when they fire together.
        combined_type = "+".join(advisory_types) if len(advisory_types) > 1 else advisory_types[0]
        advisory = Advisory(
            zone_id=zone_id,
            sensor=sensor,
            advisory_type=combined_type,
            band=None,
            value=value,
            details=details,
            timestamp=timestamp,
        )
        self._dispatcher.dispatch(advisory)
        self.stats.record_dispatch(timestamp)

    def _update_ewma(
        self, state: _ZoneGasState, value: float, timestamp: str
    ) -> Optional[float]:
        current_time = _parse_timestamp(timestamp)

        if state.ewma is None:
            state.ewma = value
            state.last_timestamp = current_time
            return None

        previous_ewma = state.ewma
        elapsed_minutes = max(
            (current_time - state.last_timestamp).total_seconds() / 60.0, 1e-6
        )
        new_ewma = _EWMA_ALPHA * value + (1 - _EWMA_ALPHA) * previous_ewma

        state.ewma = new_ewma
        state.last_timestamp = current_time

        return (new_ewma - previous_ewma) / elapsed_minutes
