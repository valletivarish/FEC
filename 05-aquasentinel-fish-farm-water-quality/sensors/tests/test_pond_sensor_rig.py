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


def test_sample_and_dispatch_interval_are_independent_within_one_sensor():
    # salinity is sampled every 30s locally but only dispatched every 60s -- this is the
    # sample-vs-dispatch decoupling PondSensorRig implements, not just cross-sensor variation.
    config = load_pond_config(CONFIG_PATH)
    salinity_settings = config["sensors"]["salinity"]
    assert salinity_settings["sample_interval_s"] != salinity_settings["dispatch_interval_s"]
    assert salinity_settings["sample_interval_s"] < salinity_settings["dispatch_interval_s"]


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


def test_metric_loop_samples_faster_than_it_dispatches(tmp_path):
    # A tiny synthetic config (0.05s sample, 0.2s dispatch) proves the runtime behaviour, not
    # just the config values: over ~0.5s this should tick ~10 times but publish only ~2-3 times.
    config_path = tmp_path / "pond-fast.yaml"
    config_path.write_text(
        "pond_id: pond-fast\n"
        "sensors:\n"
        "  salinity:\n"
        "    unit: ppt\n"
        "    sample_interval_s: 0.05\n"
        "    dispatch_interval_s: 0.2\n"
    )
    published = []
    rig = PondSensorRig(config_path, publish_callback=lambda reading: published.append(reading))
    rig.start()
    rig._stop_event.wait(0.5)
    rig.stop()

    # dispatched at least once but nowhere near the ~10 sample ticks that occurred in 0.5s
    assert 1 <= len(published) <= 4
