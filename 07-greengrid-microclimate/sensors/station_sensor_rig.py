"""Spawns one independent thread per sensor metric for a station, each
sampling and dispatching on its own configured cadence.
"""
import threading
import time
from datetime import datetime, timezone
from pathlib import Path

import yaml

from generators import GENERATORS
from mqtt_publisher import publish_reading

DEFAULT_CONFIG_DIR = Path(__file__).resolve().parent / "config"


def load_station_config(station_id: str, config_dir: Path = DEFAULT_CONFIG_DIR) -> dict:
    """Loads sensors/config/{station_id}.yaml, giving each metric its own
    independently-configurable sample_interval_s / dispatch_interval_s."""
    config_path = Path(config_dir) / f"{station_id}.yaml"
    with open(config_path, "r") as f:
        config = yaml.safe_load(f)
    return config


class StationSensorRig:
    """Runs all 10 sensor threads for one station. Each thread samples at its
    own cadence and, independently, dispatches its latest sample at its own
    cadence (sample and dispatch rates need not match, per the brief)."""

    def __init__(self, station_config: dict, mqtt_client, generators: dict = None):
        self.station_id = station_config["station_id"]
        self.sensor_config = station_config["sensors"]
        self.mqtt_client = mqtt_client
        self.generators = generators if generators is not None else GENERATORS
        self._threads = []
        self._stop_event = threading.Event()

    def start(self):
        for metric, cfg in self.sensor_config.items():
            thread = threading.Thread(
                target=self._run_metric,
                args=(metric, cfg["sample_interval_s"], cfg["dispatch_interval_s"]),
                name=f"{self.station_id}-{metric}",
                daemon=True,
            )
            self._threads.append(thread)
            thread.start()

    def stop(self):
        self._stop_event.set()
        for thread in self._threads:
            thread.join(timeout=2)

    def _run_metric(self, metric, sample_interval_s, dispatch_interval_s):
        generator_fn, unit = self.generators[metric]
        latest_value = None
        last_sample_time = 0.0
        last_dispatch_time = 0.0

        while not self._stop_event.is_set():
            now = time.monotonic()

            if now - last_sample_time >= sample_interval_s:
                latest_value = generator_fn(latest_value)
                last_sample_time = now

            if latest_value is not None and now - last_dispatch_time >= dispatch_interval_s:
                reading = {
                    "stationId": self.station_id,
                    "metric": metric,
                    "value": round(latest_value, 3),
                    "unit": unit,
                    "timestamp": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%S.%f")[:-3] + "Z",
                }
                publish_reading(self.mqtt_client, reading)
                last_dispatch_time = now

            # tick on the finer-grained of the two cadences so neither is missed.
            self._stop_event.wait(min(sample_interval_s, dispatch_interval_s) / 10.0)
