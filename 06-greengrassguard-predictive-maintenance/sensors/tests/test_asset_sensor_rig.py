"""Config loader must apply each sensor's own sample/dispatch interval independently,
and the rig must wire those values into the worker threads unchanged."""
import os

from sensors.asset_sensor_rig import AssetSensorRig, load_asset_config

CONFIG_DIR = os.path.join(os.path.dirname(os.path.dirname(__file__)), "config")


def test_load_asset_config_reads_asset_id():
    config = load_asset_config(os.path.join(CONFIG_DIR, "asset-01.yaml"))
    assert config["asset_id"] == "asset-01"


def test_load_asset_config_has_all_ten_sensors():
    config = load_asset_config(os.path.join(CONFIG_DIR, "asset-01.yaml"))
    expected = {
        "vibe-axial", "vibe-radial", "acoustic-emission", "thermal-winding",
        "thermal-bearing", "electrical-current-rms", "mech-rpm",
        "hydraulic-discharge-pressure", "hydraulic-flow", "env-humidity",
    }
    assert set(config["sensors"].keys()) == expected


def test_load_asset_config_independent_intervals_per_sensor():
    config = load_asset_config(os.path.join(CONFIG_DIR, "asset-01.yaml"))
    sensors = config["sensors"]
    # vibration is fast-cadence, env-humidity is slow-cadence: intervals must differ,
    # proving each sensor's timing is read independently rather than one shared value.
    assert sensors["vibe-axial"]["sample_interval_s"] == 1
    assert sensors["env-humidity"]["sample_interval_s"] == 30
    assert sensors["vibe-axial"]["sample_interval_s"] != sensors["env-humidity"]["sample_interval_s"]


def test_load_asset_config_sample_and_dispatch_can_differ_per_sensor(tmp_path):
    custom_config = tmp_path / "asset-99.yaml"
    custom_config.write_text(
        "asset_id: asset-99\n"
        "sensors:\n"
        "  vibe-axial:\n"
        "    unit: mm/s\n"
        "    sample_interval_s: 1\n"
        "    dispatch_interval_s: 10\n"
    )
    config = load_asset_config(str(custom_config))
    cfg = config["sensors"]["vibe-axial"]
    assert cfg["sample_interval_s"] == 1
    assert cfg["dispatch_interval_s"] == 10


class _FakeMqttClient:
    def __init__(self):
        self.published = []

    def publish(self, topic, payload):
        self.published.append((topic, payload))


def test_rig_start_spawns_a_thread_per_sensor_and_stop_joins_them():
    mqtt_client = _FakeMqttClient()
    rig = AssetSensorRig(os.path.join(CONFIG_DIR, "asset-01.yaml"), mqtt_client)
    rig.start()
    try:
        assert len(rig._workers) == 10
        assert all(w.is_alive() for w in rig._workers)
    finally:
        rig.stop(timeout=2.0)
    assert all(not w.is_alive() for w in rig._workers)


def test_rig_workers_carry_their_own_configured_intervals():
    mqtt_client = _FakeMqttClient()
    rig = AssetSensorRig(os.path.join(CONFIG_DIR, "asset-01.yaml"), mqtt_client)
    rig.start()
    try:
        by_metric = {w.metric: w for w in rig._workers}
        assert by_metric["vibe-axial"].sample_interval_s == 1
        assert by_metric["env-humidity"].sample_interval_s == 30
        assert by_metric["vibe-axial"].dispatch_interval_s != by_metric["env-humidity"].dispatch_interval_s
    finally:
        rig.stop(timeout=2.0)
