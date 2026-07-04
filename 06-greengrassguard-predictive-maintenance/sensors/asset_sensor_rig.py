"""Spawns one independent thread per sensor metric for a single asset.

Each thread owns its own sample/dispatch cadence so metrics never block each other —
a slow env-humidity dispatch must never delay a fast vibe-axial sample, for example.
"""
import threading
import time
from datetime import datetime, timezone

import yaml

from sensors.generators import GENERATORS, VIBE_METRICS, vibe_window
from sensors.mqtt_publisher import publish_reading


def load_asset_config(config_path):
    with open(config_path, "r") as f:
        return yaml.safe_load(f)


class _MetricWorker(threading.Thread):
    """One thread per (asset, metric): samples on sample_interval_s, publishes on
    dispatch_interval_s. The two cadences are independent, so a metric can be sampled
    more often than it's dispatched (or vice versa) without the loops interfering.
    """

    def __init__(self, asset_id, metric, unit, sample_interval_s, dispatch_interval_s,
                 mqtt_client, stop_event):
        super().__init__(daemon=True, name=f"{asset_id}-{metric}")
        self.asset_id = asset_id
        self.metric = metric
        self.unit = unit
        self.sample_interval_s = sample_interval_s
        self.dispatch_interval_s = dispatch_interval_s
        self.mqtt_client = mqtt_client
        self.stop_event = stop_event
        self._generator = GENERATORS[metric]
        self._value = None
        self._lock = threading.Lock()

    def _sample(self):
        with self._lock:
            self._value = self._generator(self._value)
            return self._value

    def _build_reading(self, value):
        reading = {
            "assetId": self.asset_id,
            "metric": self.metric,
            "value": value,
            "unit": self.unit,
            "timestamp": datetime.now(timezone.utc).isoformat(),
        }
        if self.metric in VIBE_METRICS:
            reading["window"] = vibe_window(value, self.metric)
        return reading

    def run(self):
        next_sample_at = time.monotonic()
        next_dispatch_at = time.monotonic()
        while not self.stop_event.is_set():
            now = time.monotonic()
            if now >= next_sample_at:
                self._sample()
                next_sample_at = now + self.sample_interval_s
            if now >= next_dispatch_at:
                with self._lock:
                    value = self._value
                if value is not None:
                    publish_reading(self.mqtt_client, self._build_reading(value))
                next_dispatch_at = now + self.dispatch_interval_s
            sleep_for = min(next_sample_at, next_dispatch_at) - time.monotonic()
            if sleep_for > 0:
                self.stop_event.wait(sleep_for)


class AssetSensorRig:
    """Owns all 10 metric threads for one asset, started/stopped as a unit."""

    def __init__(self, config_path, mqtt_client):
        self.config = load_asset_config(config_path)
        self.asset_id = self.config["asset_id"]
        self.mqtt_client = mqtt_client
        self._stop_event = threading.Event()
        self._workers = []

    def start(self):
        for metric, cfg in self.config["sensors"].items():
            worker = _MetricWorker(
                asset_id=self.asset_id,
                metric=metric,
                unit=cfg["unit"],
                sample_interval_s=cfg["sample_interval_s"],
                dispatch_interval_s=cfg["dispatch_interval_s"],
                mqtt_client=self.mqtt_client,
                stop_event=self._stop_event,
            )
            self._workers.append(worker)
            worker.start()
        return self

    def stop(self, timeout=2.0):
        self._stop_event.set()
        for worker in self._workers:
            worker.join(timeout=timeout)
