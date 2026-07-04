"""Config loader must apply each sensor's own sample_interval_s and
dispatch_interval_s independently, not a single shared rate."""
import sys
import time
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from station_sensor_rig import StationSensorRig, load_station_config

CONFIG_DIR = Path(__file__).resolve().parents[1] / "config"


def test_load_station_config_reads_station_id():
    config = load_station_config("station-quad", CONFIG_DIR)
    assert config["station_id"] == "station-quad"


def test_load_station_config_applies_independent_intervals_per_sensor():
    config = load_station_config("station-quad", CONFIG_DIR)
    sensors = config["sensors"]

    assert sensors["wind-speed"]["sample_interval_s"] == 5
    assert sensors["wind-speed"]["dispatch_interval_s"] == 5

    assert sensors["soil-moisture"]["sample_interval_s"] == 30
    assert sensors["soil-moisture"]["dispatch_interval_s"] == 30

    assert sensors["rainfall"]["sample_interval_s"] == 10
    assert sensors["pm2-5"]["sample_interval_s"] == 15

    # confirms rates are per-metric, not one global rate applied to all.
    distinct_rates = {cfg["sample_interval_s"] for cfg in sensors.values()}
    assert len(distinct_rates) > 1


def test_all_ten_metrics_present_in_config():
    config = load_station_config("station-quad", CONFIG_DIR)
    expected = {
        "air-temperature", "soil-moisture", "rainfall", "wind-speed", "wind-direction",
        "uv-index", "barometric-pressure", "pm2-5", "ambient-noise", "leaf-wetness",
    }
    assert set(config["sensors"].keys()) == expected


def test_all_three_station_configs_load_with_distinct_station_ids():
    ids = {load_station_config(sid, CONFIG_DIR)["station_id"]
           for sid in ("station-quad", "station-north-lawn", "station-arboretum")}
    assert ids == {"station-quad", "station-north-lawn", "station-arboretum"}


class _FakeMqttClient:
    def __init__(self):
        self.published = []

    def publish(self, topic, payload):
        self.published.append((topic, payload))


def test_rig_dispatches_on_its_own_fast_configured_cadence():
    config = {
        "station_id": "station-quad",
        "sensors": {
            "air-temperature": {"sample_interval_s": 0.05, "dispatch_interval_s": 0.05},
        },
    }
    fake_generators = {"air-temperature": (lambda prev: 20.0, "degC")}
    client = _FakeMqttClient()
    rig = StationSensorRig(config, client, generators=fake_generators)
    rig.start()
    time.sleep(0.3)
    rig.stop()

    assert len(client.published) >= 2
    topic, payload = client.published[0]
    assert topic == "greengrid/station-quad/air-temperature"
    assert '"metric": "air-temperature"' in payload or '"metric":"air-temperature"' in payload
