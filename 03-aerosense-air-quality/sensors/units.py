"""Unit and range constants per sensor topic, shared by the rig and tests."""
from __future__ import annotations

from dataclasses import dataclass


@dataclass(frozen=True)
class SensorSpec:
    unit: str
    min_value: float
    max_value: float


# Ranges mirror the shared contract so every module clamps identically.
SENSOR_SPECS: dict[str, SensorSpec] = {
    "co2": SensorSpec(unit="ppm", min_value=400.0, max_value=3000.0),
    "pm25": SensorSpec(unit="ug/m3", min_value=0.0, max_value=250.0),
    "pm10": SensorSpec(unit="ug/m3", min_value=0.0, max_value=350.0),
    "tvoc": SensorSpec(unit="ppb", min_value=0.0, max_value=2000.0),
    "temperature": SensorSpec(unit="C", min_value=14.0, max_value=32.0),
    "humidity": SensorSpec(unit="percent_rh", min_value=15.0, max_value=85.0),
    "co": SensorSpec(unit="ppm", min_value=0.0, max_value=50.0),
    "no2": SensorSpec(unit="ppb", min_value=0.0, max_value=200.0),
    "hcho": SensorSpec(unit="ppb", min_value=0.0, max_value=500.0),
    "occupancy_pir": SensorSpec(unit="binary", min_value=0.0, max_value=1.0),
}

MQTT_TOPIC_PREFIX = "aerosense"


def build_topic(zone_id: str, sensor: str) -> str:
    """Compose the MQTT topic for a sensor reading in a given zone."""
    return f"{MQTT_TOPIC_PREFIX}/{zone_id}/{sensor}"


def clamp(sensor: str, value: float) -> float:
    """Clamp a raw generated value into the sensor's configured min/max range."""
    spec = SENSOR_SPECS[sensor]
    return max(spec.min_value, min(spec.max_value, value))
