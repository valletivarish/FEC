"""Spawns one thread per sensor metric for a single pond.

Sampling and dispatch are decoupled per the config contract: a metric can be
sampled (its value updated) more often than it is actually published, so the
thread loop ticks on the shorter of the two intervals and only calls the
publish callback when enough time has passed since the last dispatch.
"""

import threading
from datetime import datetime, timezone

import yaml

from sensors.generators import GENERATORS

DEFAULT_UNITS = {
    "dissolved-oxygen": "mg/L",
    "water-temperature": "degC",
    "ph": "pH",
    "salinity": "ppt",
    "turbidity": "NTU",
    "ammonia-nh3-total": "mg/L",
    "nitrite-no2": "mg/L",
    "orp": "mV",
    "water-level": "cm",
    "feeder-load-cell": "g/cycle",
}


def load_pond_config(config_path):
    """Load a pond YAML config and return its parsed dict."""
    with open(config_path, "r") as f:
        return yaml.safe_load(f)


class PondSensorRig:
    """Runs all 10 sensor threads for one pond, each on its own configured cadence."""

    def __init__(self, config_path, publish_callback):
        self.config = load_pond_config(config_path)
        self.pond_id = self.config["pond_id"]
        self.publish_callback = publish_callback
        self._threads = []
        self._stop_event = threading.Event()

    def start(self):
        for metric, settings in self.config["sensors"].items():
            thread = threading.Thread(
                target=self._run_metric_loop,
                args=(metric, settings),
                name=f"{self.pond_id}-{metric}",
                daemon=True,
            )
            self._threads.append(thread)
            thread.start()

    def stop(self):
        self._stop_event.set()
        for thread in self._threads:
            thread.join(timeout=5)

    def _run_metric_loop(self, metric, settings):
        generator = GENERATORS[metric]
        unit = settings.get("unit", DEFAULT_UNITS[metric])
        sample_interval_s = settings["sample_interval_s"]
        dispatch_interval_s = settings["dispatch_interval_s"]

        # sampling never needs to be slower than dispatch, else nothing new to send
        tick_s = min(sample_interval_s, dispatch_interval_s)
        value = None
        time_since_dispatch = dispatch_interval_s  # dispatch immediately on first tick

        while not self._stop_event.is_set():
            value = generator(value)
            if time_since_dispatch >= dispatch_interval_s:
                reading = {
                    "pondId": self.pond_id,
                    "metric": metric,
                    "value": round(value, 3),
                    "unit": unit,
                    "timestamp": datetime.now(timezone.utc).isoformat(),
                }
                self.publish_callback(reading)
                time_since_dispatch = 0

            self._stop_event.wait(tick_s)
            time_since_dispatch += tick_s
