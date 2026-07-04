"""SensorRig: runs one background sampling thread per configured sensor.

Each sensor has its own frequency_s (sampling cadence) and dispatch_rate
(how often generated readings are handed to the dispatch callback), which
are independently configurable per the AeroSense brief.
"""
from __future__ import annotations

import random
import threading
import time
from dataclasses import dataclass, field
from datetime import datetime, timezone
from typing import Callable, Optional

from sensors.bands import BANDED_SENSORS, classify_band
from sensors.units import SENSOR_SPECS, clamp

Reading = dict[str, object]
DispatchCallback = Callable[[Reading], None]


@dataclass
class SensorProfile:
    """Configuration for one sensor within a zone rig."""

    frequency_s: float
    dispatch_rate: str | float  # "on_change" or a fixed interval in seconds
    min: float
    max: float
    model: str = "random_walk"
    step: Optional[float] = None
    flip_probability: Optional[float] = None


def _random_walk_model(current: float, spec_min: float, spec_max: float, step: float) -> float:
    """Bounded random walk: nudge the value and clamp back into range."""
    delta = random.uniform(-step, step)
    return max(spec_min, min(spec_max, current + delta))


def _occupancy_pir_model(current: float, flip_probability: float) -> float:
    """Occupancy flips rarely, modelling sparse room entry/exit events."""
    if random.random() < flip_probability:
        return 1.0 - current
    return current


def _default_start_value(spec_min: float, spec_max: float) -> float:
    """Seed a sensor near the low-to-mid range so startup values look plausible."""
    span = spec_max - spec_min
    return spec_min + span * random.uniform(0.15, 0.4)


@dataclass
class _SensorState:
    profile: SensorProfile
    current_value: float
    last_dispatched_band: Optional[str] = None
    last_dispatch_time: float = field(default_factory=time.monotonic)
    buffer: list[Reading] = field(default_factory=list)
    lock: threading.Lock = field(default_factory=threading.Lock)


def _iso_now() -> str:
    """Produce an ISO 8601 timestamp with a literal Z suffix, per the shared contract."""
    return datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%S.%f")[:-3] + "Z"


class SensorRig:
    """Runs and coordinates all sensor sampling threads for a single zone."""

    def __init__(
        self,
        zone_id: str,
        profiles: dict[str, dict],
        on_dispatch: DispatchCallback,
    ) -> None:
        self.zone_id = zone_id
        self.on_dispatch = on_dispatch
        self._states: dict[str, _SensorState] = {}
        self._threads: list[threading.Thread] = []
        self._stop_event = threading.Event()

        for sensor, raw_profile in profiles.items():
            if sensor not in SENSOR_SPECS:
                raise ValueError(f"unknown sensor '{sensor}' in profile")
            profile = SensorProfile(
                frequency_s=float(raw_profile["frequency_s"]),
                dispatch_rate=raw_profile["dispatch_rate"],
                min=float(raw_profile.get("min", SENSOR_SPECS[sensor].min_value)),
                max=float(raw_profile.get("max", SENSOR_SPECS[sensor].max_value)),
                model=raw_profile.get("model", "flip" if sensor == "occupancy_pir" else "random_walk"),
                step=raw_profile.get("step"),
                flip_probability=raw_profile.get("flip_probability", 0.05),
            )
            start_value = 0.0 if sensor == "occupancy_pir" else _default_start_value(profile.min, profile.max)
            self._states[sensor] = _SensorState(profile=profile, current_value=start_value)

    def start(self) -> None:
        """Spawn one daemon-free background thread per sensor and begin sampling."""
        for sensor in self._states:
            thread = threading.Thread(
                target=self._run_sensor_loop,
                args=(sensor,),
                name=f"sensor-rig-{self.zone_id}-{sensor}",
                daemon=True,
            )
            self._threads.append(thread)
            thread.start()

    def stop(self, timeout: float = 5.0) -> None:
        """Signal all sensor threads to stop and join them cleanly."""
        self._stop_event.set()
        for thread in self._threads:
            thread.join(timeout=timeout)
        self._threads.clear()

    def _run_sensor_loop(self, sensor: str) -> None:
        state = self._states[sensor]
        profile = state.profile
        while not self._stop_event.is_set():
            value = self._generate_value(sensor, state)
            reading: Reading = {
                "zone_id": self.zone_id,
                "topic": sensor,
                "value": round(value, 3),
                "timestamp": _iso_now(),
            }
            self._handle_new_reading(sensor, state, reading)
            self._stop_event.wait(profile.frequency_s)

    def _generate_value(self, sensor: str, state: _SensorState) -> float:
        profile = state.profile
        with state.lock:
            if profile.model == "flip":
                new_value = _occupancy_pir_model(
                    state.current_value, profile.flip_probability or 0.05
                )
            else:
                step = profile.step if profile.step is not None else (profile.max - profile.min) * 0.03
                new_value = _random_walk_model(state.current_value, profile.min, profile.max, step)
            new_value = max(profile.min, min(profile.max, new_value))
            new_value = clamp(sensor, new_value)
            state.current_value = new_value
        return new_value

    def _handle_new_reading(self, sensor: str, state: _SensorState, reading: Reading) -> None:
        profile = state.profile
        with state.lock:
            state.buffer.append(reading)
            if profile.dispatch_rate == "on_change":
                self._maybe_dispatch_on_change(sensor, state, reading)
            else:
                self._maybe_dispatch_on_interval(state, float(profile.dispatch_rate))

    def _maybe_dispatch_on_change(self, sensor: str, state: _SensorState, reading: Reading) -> None:
        if sensor in BANDED_SENSORS:
            new_band = classify_band(sensor, float(reading["value"]))
            if new_band != state.last_dispatched_band:
                state.last_dispatched_band = new_band
                self._flush(state, [reading])
        else:
            # Non-banded sensors (temperature, humidity, occupancy_pir) treat
            # on_change as "dispatch every sample" since there's no band model.
            self._flush(state, [reading])

    def _maybe_dispatch_on_interval(self, state: _SensorState, interval_s: float) -> None:
        now = time.monotonic()
        if now - state.last_dispatch_time >= interval_s:
            state.last_dispatch_time = now
            pending = state.buffer
            state.buffer = []
            self._flush(state, pending)

    def _flush(self, state: _SensorState, readings: list[Reading]) -> None:
        if not readings:
            return
        state.buffer = []
        for reading in readings:
            self.on_dispatch(reading)
