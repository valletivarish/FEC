"""Band transition, spike, and no-emit coverage for FogParticulate."""
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from fog_particulate import FogParticulate


class FakeDispatcher:
    def __init__(self) -> None:
        self.dispatched = []

    def dispatch(self, advisory) -> bool:
        self.dispatched.append(advisory)
        return True


def _reading(zone_id: str, sensor: str, value: float, timestamp: str = "2026-07-02T10:00:00Z") -> dict:
    return {"zone_id": zone_id, "topic": sensor, "value": value, "timestamp": timestamp}


def test_first_reading_dispatches_initial_band() -> None:
    dispatcher = FakeDispatcher()
    node = FogParticulate(dispatcher)

    node.handle_reading(_reading("z1", "pm25", 5.0))

    assert len(dispatcher.dispatched) == 1
    assert dispatcher.dispatched[0].advisory_type == "band_change"
    assert dispatcher.dispatched[0].band == "good"


def test_steady_in_band_readings_never_emit() -> None:
    dispatcher = FakeDispatcher()
    node = FogParticulate(dispatcher)

    for value in [5.0, 6.0, 5.5, 6.5, 5.8, 6.1, 5.9, 6.3]:
        node.handle_reading(_reading("z1", "pm25", value))

    # Only the very first reading should have dispatched a band_change.
    assert len(dispatcher.dispatched) == 1


def test_band_crossing_upward_dispatches_band_change() -> None:
    dispatcher = FakeDispatcher()
    node = FogParticulate(dispatcher)

    for value in [5.0, 5.0, 5.0, 5.0, 5.0]:
        node.handle_reading(_reading("z1", "pm25", value))
    dispatcher.dispatched.clear()

    # Below the spike threshold (16.8) so only the rolling median drives the band change.
    for value in [15.0, 15.0, 15.0, 15.0, 15.0]:
        node.handle_reading(_reading("z1", "pm25", value))

    assert len(dispatcher.dispatched) == 1
    assert dispatcher.dispatched[0].advisory_type == "band_change"
    assert dispatcher.dispatched[0].band == "moderate"


def test_band_crossing_downward_dispatches_band_change() -> None:
    dispatcher = FakeDispatcher()
    node = FogParticulate(dispatcher)

    for value in [40.0] * 5:
        node.handle_reading(_reading("z1", "pm25", value))
    dispatcher.dispatched.clear()

    for value in [5.0] * 5:
        node.handle_reading(_reading("z1", "pm25", value))

    assert len(dispatcher.dispatched) == 1
    assert dispatcher.dispatched[0].advisory_type == "band_change"
    assert dispatcher.dispatched[0].band == "good"


def test_spike_dispatches_even_within_same_band_window() -> None:
    dispatcher = FakeDispatcher()
    node = FogParticulate(dispatcher)

    for value in [5.0] * 5:
        node.handle_reading(_reading("z1", "pm25", value))
    dispatcher.dispatched.clear()

    # good band upper edge is 12.0; 140% of that is 16.8.
    node.handle_reading(_reading("z1", "pm25", 20.0))

    assert len(dispatcher.dispatched) == 1
    assert dispatcher.dispatched[0].advisory_type == "spike"
    assert dispatcher.dispatched[0].value == 20.0


def test_zones_and_sensors_are_tracked_independently() -> None:
    dispatcher = FakeDispatcher()
    node = FogParticulate(dispatcher)

    node.handle_reading(_reading("z1", "pm25", 5.0))
    node.handle_reading(_reading("z2", "pm25", 5.0))
    node.handle_reading(_reading("z1", "pm10", 5.0))

    assert len(dispatcher.dispatched) == 3


def test_non_particulate_sensor_is_ignored() -> None:
    dispatcher = FakeDispatcher()
    node = FogParticulate(dispatcher)

    node.handle_reading(_reading("z1", "co2", 500.0))

    assert len(dispatcher.dispatched) == 0
