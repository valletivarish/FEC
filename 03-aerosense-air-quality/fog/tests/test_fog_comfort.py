"""Comfort formula and occupancy-gate coverage for FogComfort."""
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from fog_comfort import FogComfort, compute_comfort_index


class FakeDispatcher:
    def __init__(self) -> None:
        self.dispatched = []

    def dispatch(self, advisory) -> bool:
        self.dispatched.append(advisory)
        return True


def _reading(zone_id: str, sensor: str, value: float, timestamp: str) -> dict:
    return {"zone_id": zone_id, "topic": sensor, "value": value, "timestamp": timestamp}


def test_comfort_index_is_100_in_band() -> None:
    assert compute_comfort_index(22.0, 45.0) == 100.0


def test_comfort_index_penalizes_temperature_deviation() -> None:
    index = compute_comfort_index(28.0, 45.0)
    assert index == 100.0 - (28.0 - 24.0) * 8.0


def test_comfort_index_penalizes_humidity_deviation() -> None:
    index = compute_comfort_index(22.0, 70.0)
    assert index == 100.0 - (70.0 - 60.0) * 1.0


def test_no_advisories_while_unoccupied() -> None:
    dispatcher = FakeDispatcher()
    node = FogComfort(dispatcher)

    node.handle_reading(_reading("z1", "occupancy_pir", 0, "2026-07-02T10:00:00Z"))
    node.handle_reading(_reading("z1", "temperature", 30.0, "2026-07-02T10:00:01Z"))
    node.handle_reading(_reading("z1", "humidity", 80.0, "2026-07-02T10:00:02Z"))

    assert len(dispatcher.dispatched) == 0


def test_comfort_alert_dispatched_while_occupied_and_uncomfortable() -> None:
    dispatcher = FakeDispatcher()
    node = FogComfort(dispatcher)

    node.handle_reading(_reading("z1", "occupancy_pir", 1, "2026-07-02T10:00:00Z"))
    node.handle_reading(_reading("z1", "temperature", 30.0, "2026-07-02T10:00:01Z"))
    node.handle_reading(_reading("z1", "humidity", 45.0, "2026-07-02T10:00:02Z"))

    assert len(dispatcher.dispatched) == 1
    assert dispatcher.dispatched[0].advisory_type == "comfort_alert"


def test_comfort_alert_respects_minimum_interval() -> None:
    dispatcher = FakeDispatcher()
    node = FogComfort(dispatcher)

    node.handle_reading(_reading("z1", "occupancy_pir", 1, "2026-07-02T10:00:00Z"))
    node.handle_reading(_reading("z1", "temperature", 30.0, "2026-07-02T10:00:01Z"))
    node.handle_reading(_reading("z1", "humidity", 45.0, "2026-07-02T10:00:02Z"))
    node.handle_reading(_reading("z1", "temperature", 31.0, "2026-07-02T10:00:30Z"))

    assert len(dispatcher.dispatched) == 1


def test_comfort_alert_fires_again_after_interval_elapses() -> None:
    dispatcher = FakeDispatcher()
    node = FogComfort(dispatcher)

    node.handle_reading(_reading("z1", "occupancy_pir", 1, "2026-07-02T10:00:00Z"))
    node.handle_reading(_reading("z1", "temperature", 30.0, "2026-07-02T10:00:01Z"))
    node.handle_reading(_reading("z1", "humidity", 45.0, "2026-07-02T10:00:02Z"))
    node.handle_reading(_reading("z1", "temperature", 31.0, "2026-07-02T10:03:00Z"))

    assert len(dispatcher.dispatched) == 2
    assert dispatcher.dispatched[1].advisory_type == "comfort_alert"


def test_setpoint_recommendation_on_occupied_transition_when_already_bad() -> None:
    dispatcher = FakeDispatcher()
    node = FogComfort(dispatcher)

    node.handle_reading(_reading("z1", "occupancy_pir", 0, "2026-07-02T09:59:00Z"))
    node.handle_reading(_reading("z1", "temperature", 30.0, "2026-07-02T09:59:30Z"))
    node.handle_reading(_reading("z1", "humidity", 80.0, "2026-07-02T09:59:45Z"))
    node.handle_reading(_reading("z1", "occupancy_pir", 1, "2026-07-02T10:00:00Z"))

    assert len(dispatcher.dispatched) == 1
    assert dispatcher.dispatched[0].advisory_type == "setpoint_recommendation"


def test_zone_cleared_on_unoccupied_transition() -> None:
    dispatcher = FakeDispatcher()
    node = FogComfort(dispatcher)

    node.handle_reading(_reading("z1", "occupancy_pir", 1, "2026-07-02T10:00:00Z"))
    node.handle_reading(_reading("z1", "temperature", 22.0, "2026-07-02T10:00:01Z"))
    node.handle_reading(_reading("z1", "humidity", 45.0, "2026-07-02T10:00:02Z"))
    node.handle_reading(_reading("z1", "occupancy_pir", 0, "2026-07-02T10:05:00Z"))

    assert len(dispatcher.dispatched) == 1
    assert dispatcher.dispatched[0].advisory_type == "zone_cleared"


def test_zone_cleared_suppresses_further_alerts_until_next_occupied() -> None:
    dispatcher = FakeDispatcher()
    node = FogComfort(dispatcher)

    node.handle_reading(_reading("z1", "occupancy_pir", 1, "2026-07-02T10:00:00Z"))
    node.handle_reading(_reading("z1", "temperature", 30.0, "2026-07-02T10:00:01Z"))
    node.handle_reading(_reading("z1", "humidity", 45.0, "2026-07-02T10:00:02Z"))
    node.handle_reading(_reading("z1", "occupancy_pir", 0, "2026-07-02T10:00:03Z"))
    dispatcher.dispatched.clear()

    node.handle_reading(_reading("z1", "temperature", 32.0, "2026-07-02T10:00:04Z"))
    node.handle_reading(_reading("z1", "humidity", 85.0, "2026-07-02T10:00:05Z"))

    assert len(dispatcher.dispatched) == 0
