"""Config loader must apply each sensor's own sample/dispatch interval independently."""

from pathlib import Path

from sensors.pond_sensor_rig import PondSensorRig, load_pond_config

CONFIG_PATH = Path(__file__).parent.parent / "config" / "pond-01.yaml"


def test_load_pond_config_reads_pond_id():
    config = load_pond_config(CONFIG_PATH)
    assert config["pond_id"] == "pond-01"


def test_load_pond_config_has_all_10_sensors():
    config = load_pond_config(CONFIG_PATH)
    expected = {
        "dissolved-oxygen",
        "water-temperature",
        "ph",
        "salinity",
        "turbidity",
        "ammonia-nh3-total",
        "nitrite-no2",
        "orp",
        "water-level",
        "feeder-load-cell",
    }
    assert set(config["sensors"].keys()) == expected


def test_intervals_are_independent_per_sensor():
    config = load_pond_config(CONFIG_PATH)
    do_settings = config["sensors"]["dissolved-oxygen"]
    feeder_settings = config["sensors"]["feeder-load-cell"]

    # dissolved-oxygen samples fast (hypoxia risk), feeder is checked rarely
    assert do_settings["sample_interval_s"] == 10
    assert feeder_settings["sample_interval_s"] == 300
    assert do_settings["sample_interval_s"] != feeder_settings["sample_interval_s"]
    assert do_settings["dispatch_interval_s"] != feeder_settings["dispatch_interval_s"]


def test_rig_loads_config_and_exposes_pond_id():
    rig = PondSensorRig(CONFIG_PATH, publish_callback=lambda reading: None)
    assert rig.pond_id == "pond-01"
    assert len(rig.config["sensors"]) == 10


def test_rig_start_and_stop_spawns_and_joins_all_threads():
    published = []
    rig = PondSensorRig(CONFIG_PATH, publish_callback=lambda reading: published.append(reading))
    rig.start()
    assert len(rig._threads) == 10
    rig.stop()
    for thread in rig._threads:
        assert not thread.is_alive()


def test_rig_published_reading_shape():
    published = []
    rig = PondSensorRig(CONFIG_PATH, publish_callback=lambda reading: published.append(reading))
    rig.start()
    rig._stop_event.wait(0.5)
    rig.stop()

    assert len(published) > 0
    reading = published[0]
    assert reading["pondId"] == "pond-01"
    assert reading["metric"] in rig.config["sensors"]
    assert "value" in reading
    assert "unit" in reading
    assert "timestamp" in reading
