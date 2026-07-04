"""EWMA convergence and rate-of-rise sustain-2-samples coverage for FogGases."""
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from fog_gases import FogGases


class FakeDispatcher:
    def __init__(self) -> None:
        self.dispatched = []

    def dispatch(self, advisory) -> bool:
        self.dispatched.append(advisory)
        return True


def _reading(zone_id: str, sensor: str, value: float, timestamp: str) -> dict:
    return {"zone_id": zone_id, "topic": sensor, "value": value, "timestamp": timestamp}


def test_ewma_converges_toward_steady_value() -> None:
    dispatcher = FakeDispatcher()
    node = FogGases(dispatcher)
    key = ("z1", "co2")

    timestamps = [f"2026-07-02T10:0{i}:00Z" for i in range(6)]
    for ts in timestamps:
        node.handle_reading(_reading("z1", "co2", 600.0, ts))

    state = node._state[key]
    assert abs(state.ewma - 600.0) < 0.01


def test_single_rate_breach_does_not_dispatch() -> None:
    dispatcher = FakeDispatcher()
    node = FogGases(dispatcher)

    node.handle_reading(_reading("z1", "co2", 400.0, "2026-07-02T10:00:00Z"))
    node.handle_reading(_reading("z1", "co2", 900.0, "2026-07-02T10:01:00Z"))

    assert len(dispatcher.dispatched) == 0


def test_sustained_rate_breach_for_two_samples_dispatches() -> None:
    dispatcher = FakeDispatcher()
    node = FogGases(dispatcher)

    node.handle_reading(_reading("z1", "co2", 400.0, "2026-07-02T10:00:00Z"))
    node.handle_reading(_reading("z1", "co2", 900.0, "2026-07-02T10:01:00Z"))
    node.handle_reading(_reading("z1", "co2", 1400.0, "2026-07-02T10:02:00Z"))

    assert len(dispatcher.dispatched) == 1
    assert dispatcher.dispatched[0].advisory_type == "rate_of_rise"


def test_rate_resets_after_a_calm_sample() -> None:
    dispatcher = FakeDispatcher()
    node = FogGases(dispatcher)

    node.handle_reading(_reading("z1", "co2", 400.0, "2026-07-02T10:00:00Z"))
    node.handle_reading(_reading("z1", "co2", 900.0, "2026-07-02T10:01:00Z"))
    # EWMA settles back near its prior value, so this sample's rate drops below threshold.
    node.handle_reading(_reading("z1", "co2", 400.0, "2026-07-02T10:02:00Z"))
    node.handle_reading(_reading("z1", "co2", 900.0, "2026-07-02T10:03:00Z"))

    assert len(dispatcher.dispatched) == 0


def test_absolute_limit_exceeded_dispatches_independently() -> None:
    dispatcher = FakeDispatcher()
    node = FogGases(dispatcher)

    node.handle_reading(_reading("z1", "co", 10.0, "2026-07-02T10:00:00Z"))

    assert len(dispatcher.dispatched) == 1
    assert dispatcher.dispatched[0].advisory_type == "limit_exceeded"


def test_no2_absolute_limit() -> None:
    dispatcher = FakeDispatcher()
    node = FogGases(dispatcher)

    node.handle_reading(_reading("z1", "no2", 150.0, "2026-07-02T10:00:00Z"))

    assert len(dispatcher.dispatched) == 1
    assert dispatcher.dispatched[0].advisory_type == "limit_exceeded"


def test_rate_and_limit_coalesce_into_single_call() -> None:
    dispatcher = FakeDispatcher()
    node = FogGases(dispatcher)

    node.handle_reading(_reading("z1", "no2", 20.0, "2026-07-02T10:00:00Z"))
    node.handle_reading(_reading("z1", "no2", 90.0, "2026-07-02T10:01:00Z"))
    node.handle_reading(_reading("z1", "no2", 160.0, "2026-07-02T10:02:00Z"))

    assert len(dispatcher.dispatched) == 1
    assert "rate_of_rise" in dispatcher.dispatched[0].advisory_type
    assert "limit_exceeded" in dispatcher.dispatched[0].advisory_type


def test_tvoc_is_ignored_by_fog_gases() -> None:
    dispatcher = FakeDispatcher()
    node = FogGases(dispatcher)

    node.handle_reading(_reading("z1", "tvoc", 5000.0, "2026-07-02T10:00:00Z"))

    assert len(dispatcher.dispatched) == 0
