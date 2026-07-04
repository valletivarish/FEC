"""Loads a per-vessel YAML config describing each metric's sample and dispatch cadence."""
import os
import yaml

REQUIRED_METRICS = (
    "engine-rpm",
    "engine-coolant-temp",
    "engine-oil-pressure",
    "engine-fuel-flow",
    "engine-vibration-raw",
    "hull-bilge-level",
    "nav-gps",
    "nav-attitude",
    "weather-wind-speed",
    "nav-heading",
)

CONFIG_DIR = os.path.join(os.path.dirname(__file__), "config")


def load_vessel_config(vessel_id: str, config_dir: str = None) -> dict:
    directory = config_dir or CONFIG_DIR
    path = os.path.join(directory, f"{vessel_id}.yaml")
    with open(path, "r") as f:
        config = yaml.safe_load(f)

    missing = [m for m in REQUIRED_METRICS if m not in config.get("metrics", {})]
    if missing:
        raise ValueError(f"vessel {vessel_id} config missing metrics: {missing}")

    return config
