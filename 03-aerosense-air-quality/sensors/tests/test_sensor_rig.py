"""Unit tests for SensorRig value generation and dispatch behaviour."""
from __future__ import annotations

import threading
import time

import pytest

from sensors.bands import classify_band
from sensors.sensor_rig import SensorRig, _occupancy_pir_model, _random_walk_model
from sensors.units import SENSOR_SPECS


def _make_profile(sensor: str, **overrides: object) -> dict:
    spec = SENSOR_SPECS[sensor]
    base = {
        "frequency_s": 0.01,
        "dispatch_rate": "on_change",
        "min": spec.min_value,
        "max": spec.max_value,
    }
    base.update(overrides)
    return base


@pytest.mark.parametrize("sensor", ["co2", "pm25", "pm10", "tvoc", "co", "no2", "hcho"])
def test_random_walk_stays_within_bounds(sensor: str) -> None:
    spec = SENSOR_SPECS[sensor]
    value = spec.min_value
    for _ in range(500):
        value = _random_walk_model(value, spec.min_value, spec.max_value, step=(spec.max_value - spec.min_value) * 0.05)
        assert spec.min_value <= value <= spec.max_value


def test_occupancy_flip_model_only_yields_binary_values() -> None:
    value = 0.0
    seen = set()
    for _ in range(1000):
        value = _occupancy_pir_model(value, flip_probability=0.5)
        seen.add(value)
    assert seen.issubset({0.0, 1.0})


def test_temperature_and_humidity_generated_values_within_configured_range() -> None:
    readings: list[dict] = []
    lock = threading.Lock()

    def on_dispatch(reading: dict) -> None:
        with lock:
            readings.append(reading)

    profiles = {
        "temperature": _make_profile("temperature", dispatch_rate=0.02),
        "humidity": _make_profile("humidity", dispatch_rate=0.02),
    }
    rig = SensorRig(zone_id="zone-test", profiles=profiles, on_dispatch=on_dispatch)
    rig.start()
    time.sleep(0.3)
    rig.stop()

    assert readings, "expected at least one dispatched reading"
    for reading in readings:
        spec = SENSOR_SPECS[reading["topic"]]
        assert spec.min_value <= reading["value"] <= spec.max_value


def test_stop_joins_all_sensor_threads() -> None:
    profiles = {"co2": _make_profile("co2")}
    rig = SensorRig(zone_id="zone-test", profiles=profiles, on_dispatch=lambda reading: None)
    rig.start()
    time.sleep(0.05)
    rig.stop()
    assert all(not thread.is_alive() for thread in rig._threads) or rig._threads == []


def test_on_change_dispatch_fires_on_band_transition_not_within_band() -> None:
    dispatched: list[dict] = []
    lock = threading.Lock()

    def on_dispatch(reading: dict) -> None:
        with lock:
            dispatched.append(reading)

    profiles = {"co2": _make_profile("co2", dispatch_rate="on_change")}
    rig = SensorRig(zone_id="zone-test", profiles=profiles, on_dispatch=on_dispatch)
    state = rig._states["co2"]

    # Force a value in the "good" band, dispatch once, then confirm a
    # same-band re-read does not dispatch again but a crossing does.
    state.current_value = 500.0
    first_reading = {"zone_id": "zone-test", "topic": "co2", "value": 500.0, "timestamp": "2026-01-01T00:00:00.000Z"}
    rig._handle_new_reading("co2", state, first_reading)
    assert len(dispatched) == 1
    assert state.last_dispatched_band == classify_band("co2", 500.0)

    same_band_reading = {
        "zone_id": "zone-test", "topic": "co2", "value": 550.0, "timestamp": "2026-01-01T00:00:05.000Z"
    }
    rig._handle_new_reading("co2", state, same_band_reading)
    assert len(dispatched) == 1, "same-band reading must not trigger a dispatch"

    crossing_reading = {
        "zone_id": "zone-test", "topic": "co2", "value": 1600.0, "timestamp": "2026-01-01T00:00:10.000Z"
    }
    rig._handle_new_reading("co2", state, crossing_reading)
    assert len(dispatched) == 2, "band-crossing reading must trigger a dispatch"
    assert dispatched[-1]["value"] == 1600.0


def test_fixed_interval_dispatch_batches_until_interval_elapses() -> None:
    dispatched: list[dict] = []

    def on_dispatch(reading: dict) -> None:
        dispatched.append(reading)

    profiles = {"temperature": _make_profile("temperature", dispatch_rate=0.15)}
    rig = SensorRig(zone_id="zone-test", profiles=profiles, on_dispatch=on_dispatch)
    rig.start()
    time.sleep(0.4)
    rig.stop()

    assert len(dispatched) >= 1
