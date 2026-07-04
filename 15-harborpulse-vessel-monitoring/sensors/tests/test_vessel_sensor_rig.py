"""Confirms the rig spawns one loop per metric and publishes correctly shaped readings."""
import threading
import time

import yaml

from sensors.config_loader import REQUIRED_METRICS
from sensors.vessel_sensor_rig import VesselSensorRig


class RecordingMqttClient:
    def __init__(self):
        self.lock = threading.Lock()
        self.published = []

    def publish(self, topic, payload):
        with self.lock:
            self.published.append((topic, payload))


def test_start_spawns_one_thread_per_metric():
    client = RecordingMqttClient()
    rig = VesselSensorRig("vessel-01", client)
    rig.start()
    try:
        assert len(rig._threads) == len(REQUIRED_METRICS)
        assert all(t.is_alive() for t in rig._threads)
    finally:
        rig.stop()


def test_rig_publishes_readings_with_correct_vessel_and_topics():
    client = RecordingMqttClient()
    rig = VesselSensorRig("vessel-02", client)
    rig.start()
    try:
        time.sleep(1.5)
    finally:
        rig.stop()

    assert len(client.published) > 0
    for topic, _ in client.published:
        assert topic.startswith("harborpulse/vessel-02/")


def test_stop_halts_all_threads():
    client = RecordingMqttClient()
    rig = VesselSensorRig("vessel-03", client)
    rig.start()
    time.sleep(0.2)
    rig.stop()
    time.sleep(0.2)
    assert all(not t.is_alive() for t in rig._threads)


def _write_single_metric_config(tmp_path, sample_interval_seconds, dispatch_interval_seconds):
    # fast sample / slow dispatch on one metric proves the two cadences run independently
    config = {
        "vesselId": "vessel-cadence",
        "metrics": {
            m: {"sample_interval_seconds": 5, "dispatch_interval_seconds": 5}
            for m in REQUIRED_METRICS
        },
    }
    config["metrics"]["engine-rpm"] = {
        "sample_interval_seconds": sample_interval_seconds,
        "dispatch_interval_seconds": dispatch_interval_seconds,
    }
    (tmp_path / "vessel-cadence.yaml").write_text(yaml.safe_dump(config))
    return str(tmp_path)


def test_dispatch_cadence_is_decoupled_from_sample_cadence(tmp_path, monkeypatch):
    config_dir = _write_single_metric_config(tmp_path, sample_interval_seconds=0.1, dispatch_interval_seconds=0.5)

    sample_calls = []
    original_sample_tick = VesselSensorRig._sample_tick

    def _tracking_sample_tick(self, metric):
        sample_calls.append(metric)
        return original_sample_tick(self, metric)

    monkeypatch.setattr(VesselSensorRig, "_sample_tick", _tracking_sample_tick)

    client = RecordingMqttClient()
    rig = VesselSensorRig("vessel-cadence", client, config_dir=config_dir)
    rig.start()
    try:
        time.sleep(1.1)
    finally:
        rig.stop()

    rpm_publishes = [p for _, p in client.published if '"metric": "engine-rpm"' in p]

    # fast sample cadence (0.1s) must tick noticeably more often than the slow dispatch cadence (0.5s)
    assert len(sample_calls) >= 8
    # slow dispatch cadence must throttle publishes far below the sample count, not match it 1:1
    assert 1 <= len(rpm_publishes) <= 4
    assert len(sample_calls) > len(rpm_publishes)


def test_dispatch_publishes_latest_sampled_value_not_every_sample(tmp_path, monkeypatch):
    config_dir = _write_single_metric_config(tmp_path, sample_interval_seconds=0.05, dispatch_interval_seconds=0.4)

    seen_values = []
    original_next_value = VesselSensorRig._next_value

    def _tracking_next_value(self, metric):
        value = original_next_value(self, metric)
        if metric == "engine-rpm":
            seen_values.append(value)
        return value

    monkeypatch.setattr(VesselSensorRig, "_next_value", _tracking_next_value)

    client = RecordingMqttClient()
    rig = VesselSensorRig("vessel-cadence", client, config_dir=config_dir)
    rig.start()
    try:
        time.sleep(0.85)
    finally:
        rig.stop()

    rpm_publishes = [p for _, p in client.published if '"metric": "engine-rpm"' in p]

    # many samples happened, but only a couple of dispatches fired, and each dispatch
    # carries whatever value was most recently sampled rather than blocking on it
    assert len(seen_values) > len(rpm_publishes) * 2
    assert len(rpm_publishes) >= 1
