"""Confirms the YAML loader exposes independent per-metric per-vessel cadence settings."""
import os

import pytest
import yaml

from sensors.config_loader import REQUIRED_METRICS, load_vessel_config

CONFIG_DIR = os.path.join(os.path.dirname(__file__), "..", "config")


def test_loads_all_three_vessel_configs():
    for vessel_id in ("vessel-01", "vessel-02", "vessel-03"):
        config = load_vessel_config(vessel_id, CONFIG_DIR)
        assert config["vesselId"] == vessel_id


def test_all_required_metrics_present_per_vessel():
    for vessel_id in ("vessel-01", "vessel-02", "vessel-03"):
        config = load_vessel_config(vessel_id, CONFIG_DIR)
        for metric in REQUIRED_METRICS:
            assert metric in config["metrics"]


def test_each_metric_has_independent_sample_and_dispatch_intervals():
    config = load_vessel_config("vessel-01", CONFIG_DIR)
    rpm_cfg = config["metrics"]["engine-rpm"]
    wind_cfg = config["metrics"]["weather-wind-speed"]
    assert "sample_interval_seconds" in rpm_cfg
    assert "dispatch_interval_seconds" in rpm_cfg
    assert rpm_cfg["sample_interval_seconds"] != wind_cfg["sample_interval_seconds"]


def test_vessel_03_has_decoupled_sample_and_dispatch_cadence():
    # vessel-03's engine-rpm intentionally samples faster than it dispatches
    config = load_vessel_config("vessel-03", CONFIG_DIR)
    rpm_cfg = config["metrics"]["engine-rpm"]
    assert rpm_cfg["sample_interval_seconds"] != rpm_cfg["dispatch_interval_seconds"]


def test_configs_are_independent_across_vessels(tmp_path):
    config_dir = tmp_path
    vessel_a = {
        "vesselId": "vessel-a",
        "metrics": {m: {"sample_interval_seconds": 1, "dispatch_interval_seconds": 1} for m in REQUIRED_METRICS},
    }
    vessel_b = {
        "vesselId": "vessel-b",
        "metrics": {m: {"sample_interval_seconds": 9, "dispatch_interval_seconds": 9} for m in REQUIRED_METRICS},
    }
    (config_dir / "vessel-a.yaml").write_text(yaml.safe_dump(vessel_a))
    (config_dir / "vessel-b.yaml").write_text(yaml.safe_dump(vessel_b))

    loaded_a = load_vessel_config("vessel-a", str(config_dir))
    loaded_b = load_vessel_config("vessel-b", str(config_dir))

    assert loaded_a["metrics"]["engine-rpm"]["sample_interval_seconds"] == 1
    assert loaded_b["metrics"]["engine-rpm"]["sample_interval_seconds"] == 9


def test_missing_metric_raises_value_error(tmp_path):
    incomplete = {
        "vesselId": "vessel-x",
        "metrics": {"engine-rpm": {"sample_interval_seconds": 1, "dispatch_interval_seconds": 1}},
    }
    (tmp_path / "vessel-x.yaml").write_text(yaml.safe_dump(incomplete))

    with pytest.raises(ValueError):
        load_vessel_config("vessel-x", str(tmp_path))
