"""Occupancy-gated comfort index from temperature and humidity deviation."""
from __future__ import annotations

from collections import defaultdict
from datetime import datetime
from typing import Optional

from advisory import Advisory
from dispatcher import AdvisoryDispatcher
from node_stats import NodeStats

COMFORT_SENSORS = {"temperature", "humidity", "occupancy_pir"}

_DEFAULT_TEMP_BAND_C = (20.0, 24.0)
_DEFAULT_RH_BAND = (30.0, 60.0)

# Weighted so a degree of temperature deviation costs more than a point of RH,
# reflecting how much more sensitive perceived comfort is to temperature.
_TEMP_PENALTY_WEIGHT = 8.0
_RH_PENALTY_WEIGHT = 1.0

_ALERT_THRESHOLD = 70.0
_MIN_ALERT_INTERVAL_S = 120.0


def _parse_timestamp(timestamp: str) -> datetime:
    return datetime.fromisoformat(timestamp.replace("Z", "+00:00"))


def compute_comfort_index(
    temperature_c: float,
    humidity_rh: float,
    temp_band: tuple[float, float] = _DEFAULT_TEMP_BAND_C,
    rh_band: tuple[float, float] = _DEFAULT_RH_BAND,
) -> float:
    """Score 0-100 from weighted deviation of temperature/humidity outside their bands."""
    temp_low, temp_high = temp_band
    rh_low, rh_high = rh_band

    temp_deviation = max(temp_low - temperature_c, temperature_c - temp_high, 0.0)
    rh_deviation = max(rh_low - humidity_rh, humidity_rh - rh_high, 0.0)

    penalty = temp_deviation * _TEMP_PENALTY_WEIGHT + rh_deviation * _RH_PENALTY_WEIGHT
    return max(0.0, 100.0 - penalty)


class _ZoneComfortState:
    """Per-zone latest readings, occupancy state, and last-dispatch bookkeeping."""

    def __init__(self) -> None:
        self.temperature: Optional[float] = None
        self.humidity: Optional[float] = None
        self.occupied: Optional[bool] = None
        self.last_alert_time: Optional[datetime] = None


class FogComfort:
    """Computes comfort index and dispatches alerts/transitions only while occupied."""

    def __init__(
        self,
        dispatcher: AdvisoryDispatcher,
        temp_band: tuple[float, float] = _DEFAULT_TEMP_BAND_C,
        rh_band: tuple[float, float] = _DEFAULT_RH_BAND,
        stats: Optional[NodeStats] = None,
    ) -> None:
        self._dispatcher = dispatcher
        self._temp_band = temp_band
        self._rh_band = rh_band
        self.stats = stats or NodeStats("FogComfort")
        self._state: dict[str, _ZoneComfortState] = defaultdict(_ZoneComfortState)

    def handle_reading(self, reading: dict) -> None:
        sensor = reading["topic"]
        if sensor not in COMFORT_SENSORS:
            return

        self.stats.record_received()

        zone_id = reading["zone_id"]
        state = self._state[zone_id]

        if sensor == "occupancy_pir":
            self._handle_occupancy(state, zone_id, reading)
            self.stats.record_processed()
            return

        if sensor == "temperature":
            state.temperature = float(reading["value"])
        else:
            state.humidity = float(reading["value"])

        if state.occupied and state.temperature is not None and state.humidity is not None:
            self._evaluate_alert(state, zone_id, reading["timestamp"])
        self.stats.record_processed()

    def _handle_occupancy(self, state: _ZoneComfortState, zone_id: str, reading: dict) -> None:
        newly_occupied = bool(int(reading["value"]))
        was_occupied = state.occupied
        state.occupied = newly_occupied
        timestamp = reading["timestamp"]

        if was_occupied is True and newly_occupied is False:
            self._dispatch(zone_id, "zone_cleared", None, timestamp)
            state.last_alert_time = None
            return

        if newly_occupied and was_occupied is not True:
            if state.temperature is not None and state.humidity is not None:
                index = compute_comfort_index(
                    state.temperature, state.humidity, self._temp_band, self._rh_band
                )
                if index < _ALERT_THRESHOLD:
                    self._dispatch(
                        zone_id, "setpoint_recommendation", index, timestamp
                    )
                    state.last_alert_time = _parse_timestamp(timestamp)

    def _evaluate_alert(self, state: _ZoneComfortState, zone_id: str, timestamp: str) -> None:
        index = compute_comfort_index(
            state.temperature, state.humidity, self._temp_band, self._rh_band
        )
        if index >= _ALERT_THRESHOLD:
            return

        current_time = _parse_timestamp(timestamp)
        if state.last_alert_time is not None:
            elapsed = (current_time - state.last_alert_time).total_seconds()
            if elapsed < _MIN_ALERT_INTERVAL_S:
                return

        self._dispatch(zone_id, "comfort_alert", index, timestamp)
        state.last_alert_time = current_time

    def _dispatch(
        self, zone_id: str, advisory_type: str, index: Optional[float], timestamp: str
    ) -> None:
        advisory = Advisory(
            zone_id=zone_id,
            sensor="comfort",
            advisory_type=advisory_type,
            band=None,
            value=index,
            details={"temp_band": self._temp_band, "rh_band": self._rh_band},
            timestamp=timestamp,
        )
        self._dispatcher.dispatch(advisory)
        self.stats.record_dispatch(timestamp)
