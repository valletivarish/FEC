"""Spawns one independent thread per sensor metric per vessel, each on its own configured
sample/dispatch cadence, publishing readings over MQTT."""
import random
import threading
from datetime import datetime, timezone

from sensors import generators
from sensors.config_loader import load_vessel_config
from sensors.mqtt_publisher import publish_reading

METRIC_UNITS = {
    "engine-rpm": "rpm",
    "engine-coolant-temp": "degC",
    "engine-oil-pressure": "kPa",
    "engine-fuel-flow": "L/h",
    "engine-vibration-raw": "g",
    "hull-bilge-level": "mm",
    "nav-gps": "latlon",
    "nav-attitude": "deg",
    "weather-wind-speed": "kn",
    "nav-heading": "deg",
}

# bilge alarm bursts are scripted per vessel so SafetyFog's rising-fast path is genuinely exercised
BILGE_BURST_VESSELS = {"vessel-02"}


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


class VesselSensorRig:
    """Runs all 10 metric generator loops for a single vessel as daemon threads."""

    def __init__(self, vessel_id: str, mqtt_client, config_dir: str = None):
        self.vessel_id = vessel_id
        self.mqtt_client = mqtt_client
        self.config = load_vessel_config(vessel_id, config_dir)
        self._threads = []
        self._stop_event = threading.Event()
        self._latest = {}
        self._bilge_burst_ticks_remaining = 0

    def start(self) -> None:
        for metric in self.config["metrics"]:
            metric_cfg = self.config["metrics"][metric]
            thread = threading.Thread(
                target=self._run_metric_loop,
                args=(metric, metric_cfg["sample_interval_seconds"], metric_cfg["dispatch_interval_seconds"]),
                daemon=True,
                name=f"{self.vessel_id}-{metric}",
            )
            self._threads.append(thread)
            thread.start()

    def stop(self) -> None:
        self._stop_event.set()
        for thread in self._threads:
            thread.join(timeout=1)

    def _run_metric_loop(self, metric: str, sample_interval_seconds: float, dispatch_interval_seconds: float) -> None:
        # single thread, two independent cadences: sampling refreshes _latest, dispatch
        # publishes whatever _latest currently holds, so a slow dispatch never blocks sampling
        tick = min(sample_interval_seconds, dispatch_interval_seconds)
        next_sample_at = 0.0
        next_dispatch_at = 0.0
        elapsed = 0.0
        self._sample_tick(metric)
        while not self._stop_event.is_set():
            if self._stop_event.wait(tick):
                break
            elapsed += tick
            if elapsed >= next_sample_at + sample_interval_seconds:
                next_sample_at = elapsed
                self._sample_tick(metric)
            if elapsed >= next_dispatch_at + dispatch_interval_seconds:
                next_dispatch_at = elapsed
                self._dispatch_tick(metric)

    def _sample_tick(self, metric: str) -> None:
        self._latest[metric] = self._next_value(metric)

    def _dispatch_tick(self, metric: str) -> None:
        value = self._latest.get(metric)
        if value is None:
            return
        reading = {
            "vesselId": self.vessel_id,
            "metric": metric,
            "value": value,
            "unit": METRIC_UNITS[metric],
            "timestamp": _now_iso(),
        }
        publish_reading(self.mqtt_client, reading)

    def _next_value(self, metric: str):
        previous = self._latest.get(metric)
        if metric == "engine-rpm":
            return generators.next_engine_rpm(previous)
        if metric == "engine-coolant-temp":
            return generators.next_engine_coolant_temp(previous)
        if metric == "engine-oil-pressure":
            return generators.next_engine_oil_pressure(previous)
        if metric == "engine-fuel-flow":
            return generators.next_engine_fuel_flow(previous)
        if metric == "engine-vibration-raw":
            return generators.next_engine_vibration_raw(previous)
        if metric == "hull-bilge-level":
            return self._next_bilge_level(previous)
        if metric == "nav-gps":
            return generators.next_nav_gps(previous)
        if metric == "nav-attitude":
            return generators.next_nav_attitude(previous)
        if metric == "weather-wind-speed":
            return generators.next_weather_wind_speed(previous)
        if metric == "nav-heading":
            return generators.next_nav_heading(previous)
        raise ValueError(f"unknown metric {metric}")

    def _next_bilge_level(self, previous):
        # occasionally trigger a multi-tick rising burst on the scripted vessel to exercise SafetyFog
        if self.vessel_id in BILGE_BURST_VESSELS:
            if self._bilge_burst_ticks_remaining == 0 and random.random() < 0.02:
                self._bilge_burst_ticks_remaining = random.randint(4, 8)
            if self._bilge_burst_ticks_remaining > 0:
                self._bilge_burst_ticks_remaining -= 1
                return generators.next_hull_bilge_level(previous, rising_burst=True)
        return generators.next_hull_bilge_level(previous, rising_burst=False)
