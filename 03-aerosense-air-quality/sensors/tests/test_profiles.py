"""Tests that YAML zone profiles parse and expose the required per-sensor keys."""
from __future__ import annotations

from pathlib import Path

import pytest
import yaml

from sensors.units import SENSOR_SPECS

PROFILES_DIR = Path(__file__).resolve().parent.parent / "profiles"
REQUIRED_SENSOR_KEYS = {"frequency_s", "dispatch_rate", "min", "max"}


def _profile_paths() -> list[Path]:
    return sorted(PROFILES_DIR.glob("*.yaml"))


@pytest.mark.parametrize("profile_path", _profile_paths(), ids=lambda p: p.name)
def test_profile_parses_as_yaml(profile_path: Path) -> None:
    with open(profile_path, "r", encoding="utf-8") as handle:
        data = yaml.safe_load(handle)
    assert isinstance(data, dict)
    assert "zone_id" in data
    assert "sensors" in data


@pytest.mark.parametrize("profile_path", _profile_paths(), ids=lambda p: p.name)
def test_profile_covers_all_known_sensors(profile_path: Path) -> None:
    with open(profile_path, "r", encoding="utf-8") as handle:
        data = yaml.safe_load(handle)
    sensors = data["sensors"]
    assert set(sensors.keys()) == set(SENSOR_SPECS.keys())


@pytest.mark.parametrize("profile_path", _profile_paths(), ids=lambda p: p.name)
def test_each_sensor_has_required_keys(profile_path: Path) -> None:
    with open(profile_path, "r", encoding="utf-8") as handle:
        data = yaml.safe_load(handle)
    for sensor_name, config in data["sensors"].items():
        missing = REQUIRED_SENSOR_KEYS - config.keys()
        assert not missing, f"{profile_path.name}:{sensor_name} missing keys {missing}"


@pytest.mark.parametrize("profile_path", _profile_paths(), ids=lambda p: p.name)
def test_dispatch_rate_values_are_on_change_or_numeric(profile_path: Path) -> None:
    with open(profile_path, "r", encoding="utf-8") as handle:
        data = yaml.safe_load(handle)
    for sensor_name, config in data["sensors"].items():
        rate = config["dispatch_rate"]
        assert rate == "on_change" or isinstance(rate, (int, float)), (
            f"{profile_path.name}:{sensor_name} has invalid dispatch_rate {rate!r}"
        )


def test_occupancy_pir_uses_fast_frequency_across_all_profiles() -> None:
    for profile_path in _profile_paths():
        with open(profile_path, "r", encoding="utf-8") as handle:
            data = yaml.safe_load(handle)
        occupancy = data["sensors"]["occupancy_pir"]
        assert occupancy["frequency_s"] <= 5
        assert occupancy["dispatch_rate"] == "on_change"
