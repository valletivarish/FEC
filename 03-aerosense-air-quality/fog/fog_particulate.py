"""Denoises particulate/VOC readings and dispatches only on band change or spike."""
from __future__ import annotations

import statistics
from collections import defaultdict, deque
from typing import Optional

from advisory import Advisory, band_upper_edge, classify_band
from dispatcher import AdvisoryDispatcher
from node_stats import NodeStats

PARTICULATE_SENSORS = {"pm25", "pm10", "tvoc", "hcho"}
_ROLLING_WINDOW = 5
_SPIKE_MULTIPLIER = 1.4


class FogParticulate:
    """Rolling-median smoothing plus band-change/spike detection per zone and sensor."""

    def __init__(self, dispatcher: AdvisoryDispatcher, stats: Optional[NodeStats] = None) -> None:
        self._dispatcher = dispatcher
        self.stats = stats or NodeStats("FogParticulate")
        # (zone_id, sensor) -> deque of the last N raw readings.
        self._windows: dict[tuple[str, str], deque[float]] = defaultdict(
            lambda: deque(maxlen=_ROLLING_WINDOW)
        )
        # (zone_id, sensor) -> last band we actually dispatched for.
        self._last_band: dict[tuple[str, str], str] = {}

    def handle_reading(self, reading: dict) -> None:
        sensor = reading["topic"]
        if sensor not in PARTICULATE_SENSORS:
            return

        self.stats.record_received()

        zone_id = reading["zone_id"]
        raw_value = float(reading["value"])
        key = (zone_id, sensor)

        window = self._windows[key]
        window.append(raw_value)
        smoothed = statistics.median(window)

        band = classify_band(sensor, smoothed)
        upper_edge = band_upper_edge(sensor, band)

        # Spike check uses the raw reading, not the smoothed value, so a real
        # short-lived excursion is never masked by the rolling median.
        if upper_edge != float("inf") and raw_value > upper_edge * _SPIKE_MULTIPLIER:
            self.stats.record_processed()
            self._dispatch(zone_id, sensor, "spike", band, raw_value, reading["timestamp"])
            self._last_band[key] = band
            return

        previous_band = self._last_band.get(key)
        if previous_band is not None and previous_band == band:
            self.stats.record_processed()
            return  # steady in-band reading: suppressing this is the whole point

        self.stats.record_processed()
        self._dispatch(zone_id, sensor, "band_change", band, smoothed, reading["timestamp"])
        self._last_band[key] = band

    def _dispatch(
        self,
        zone_id: str,
        sensor: str,
        advisory_type: str,
        band: str,
        value: float,
        timestamp: str,
    ) -> None:
        advisory = Advisory(
            zone_id=zone_id,
            sensor=sensor,
            advisory_type=advisory_type,
            band=band,
            value=value,
            details={"window_size": _ROLLING_WINDOW},
            timestamp=timestamp,
        )
        self._dispatcher.dispatch(advisory)
        self.stats.record_dispatch(timestamp)
