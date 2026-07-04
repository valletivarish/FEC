from datetime import datetime, timedelta

import pytest

from fog.fog_ops import OpsFog

POND = "pond-03"
BASE_TIME = datetime(2026, 1, 1, 6, 0, 0)


def ts(minute_offset: int) -> str:
    return (BASE_TIME + timedelta(minutes=minute_offset)).isoformat() + "Z"


def reading(metric: str, value: float, minute_offset: int, pond=POND) -> dict:
    units = {
        "feeder-load-cell": "g/cycle",
        "ammonia-nh3-total": "mg/L",
        "turbidity": "NTU",
        "orp": "mV",
    }
    return {"pondId": pond, "metric": metric, "value": value, "unit": units[metric], "timestamp": ts(minute_offset)}


def feed_flat_baseline(fog: OpsFog, minutes: list, value=100.0):
    """Seeds a flat feeder-load-cell history so later spikes read as a clear rise above median."""
    for m in minutes:
        fog.on_reading(reading("feeder-load-cell", value, m))


class TestConfidenceScoreCombinations:
    """Exercises OpsFog._compute_confidence directly across all 5 signal-count cases -- the
    dispatch-edge behaviour (tested separately below) can only ever observe the confidence value
    at the moment a NEW signal tips it over 0.5, so checking the scoring function itself is the
    only way to assert every one of the 0/1/2/3/4-signals-active combinations independently.
    """

    def test_zero_signals(self):
        fog = OpsFog()
        feed_flat_baseline(fog, [0, 10, 20])
        fog.on_reading(reading("ammonia-nh3-total", 0.5, 0))
        fog.on_reading(reading("ammonia-nh3-total", 0.5, 30))
        confidence, signals = fog._compute_confidence(fog._state_for(POND))
        assert confidence == pytest.approx(0.0)
        assert signals == []

    def test_one_signal(self):
        fog = OpsFog()
        feed_flat_baseline(fog, [0, 10, 20])
        fog.on_reading(reading("ammonia-nh3-total", 0.2, 0))
        fog.on_reading(reading("ammonia-nh3-total", 0.8, 30))
        confidence, signals = fog._compute_confidence(fog._state_for(POND))
        assert confidence == pytest.approx(0.25)
        assert signals == ["ammonia_rising"]

    def test_two_signals_at_dispatch_threshold(self):
        fog = OpsFog()
        feed_flat_baseline(fog, [0, 10, 20])
        fog.on_reading(reading("ammonia-nh3-total", 0.2, 0))
        fog.on_reading(reading("turbidity", 10.0, 0))
        fog.on_reading(reading("ammonia-nh3-total", 0.8, 30))
        fog.on_reading(reading("turbidity", 40.0, 30))
        confidence, signals = fog._compute_confidence(fog._state_for(POND))
        assert confidence == pytest.approx(0.5)
        assert set(signals) == {"ammonia_rising", "turbidity_rising"}

    def test_three_signals(self):
        fog = OpsFog()
        feed_flat_baseline(fog, [0, 10, 20])
        fog.on_reading(reading("ammonia-nh3-total", 0.2, 0))
        fog.on_reading(reading("turbidity", 10.0, 0))
        fog.on_reading(reading("orp", 300.0, 0))
        fog.on_reading(reading("ammonia-nh3-total", 0.8, 30))
        fog.on_reading(reading("turbidity", 40.0, 30))
        fog.on_reading(reading("orp", 100.0, 30))
        confidence, signals = fog._compute_confidence(fog._state_for(POND))
        assert confidence == pytest.approx(0.75)
        assert set(signals) == {"ammonia_rising", "turbidity_rising", "orp_falling"}

    def test_four_signals(self):
        fog = OpsFog()
        feed_flat_baseline(fog, [0, 10, 20])
        fog.on_reading(reading("ammonia-nh3-total", 0.2, 0))
        fog.on_reading(reading("turbidity", 10.0, 0))
        fog.on_reading(reading("orp", 300.0, 0))
        fog.on_reading(reading("ammonia-nh3-total", 0.8, 30))
        fog.on_reading(reading("turbidity", 40.0, 30))
        fog.on_reading(reading("orp", 100.0, 30))
        fog.on_reading(reading("feeder-load-cell", 200.0, 30))
        confidence, signals = fog._compute_confidence(fog._state_for(POND))
        assert confidence == pytest.approx(1.0)
        assert set(signals) == {
            "feeder_load_above_median",
            "ammonia_rising",
            "turbidity_rising",
            "orp_falling",
        }


class TestRisingEdgeOnly:
    def test_dispatch_fires_the_moment_confidence_crosses_0_5(self):
        fog = OpsFog()
        feed_flat_baseline(fog, [0, 10, 20])
        fog.on_reading(reading("ammonia-nh3-total", 0.2, 0))
        fog.on_reading(reading("turbidity", 10.0, 0))
        fog.on_reading(reading("ammonia-nh3-total", 0.8, 30))
        events = fog.on_reading(reading("turbidity", 40.0, 30))
        assert len(events) == 1
        assert events[0]["overfeeding_confidence"] == pytest.approx(0.5)
        assert len(events[0]["contributing_signals"]) == 2

    def test_no_redispatch_while_confidence_stays_above_threshold(self):
        fog = OpsFog()
        feed_flat_baseline(fog, [0, 10, 20])
        fog.on_reading(reading("ammonia-nh3-total", 0.2, 0))
        fog.on_reading(reading("turbidity", 10.0, 0))
        fog.on_reading(reading("orp", 300.0, 0))
        fog.on_reading(reading("ammonia-nh3-total", 0.8, 30))
        first = fog.on_reading(reading("turbidity", 40.0, 30))
        assert len(first) == 1

        # orp falling adds a 3rd corroborating signal but confidence was already >= 0.5: no re-dispatch
        second = fog.on_reading(reading("orp", 100.0, 30))
        assert second == []

    def test_redispatches_on_new_rising_edge_after_drop_below_threshold(self):
        fog = OpsFog()
        feed_flat_baseline(fog, [0, 10, 20])
        fog.on_reading(reading("ammonia-nh3-total", 0.2, 0))
        fog.on_reading(reading("turbidity", 10.0, 0))
        fog.on_reading(reading("ammonia-nh3-total", 0.8, 30))
        first = fog.on_reading(reading("turbidity", 40.0, 30))
        assert len(first) == 1

        # turbidity and ammonia both fall back: confidence drops below 0.5 (falling edge, no event)
        fog.on_reading(reading("ammonia-nh3-total", 0.1, 60))
        drop_events = fog.on_reading(reading("turbidity", 5.0, 60))
        assert drop_events == []

        # signals corroborate again -> new rising edge should dispatch again
        fog.on_reading(reading("ammonia-nh3-total", 0.9, 90))
        third = fog.on_reading(reading("turbidity", 50.0, 90))
        assert len(third) == 1

    def test_event_shape(self):
        fog = OpsFog()
        feed_flat_baseline(fog, [0, 10, 20])
        fog.on_reading(reading("ammonia-nh3-total", 0.2, 0))
        fog.on_reading(reading("turbidity", 10.0, 0))
        fog.on_reading(reading("ammonia-nh3-total", 0.8, 30))
        events = fog.on_reading(reading("turbidity", 40.0, 30))
        event = events[0]
        assert event["type"] == "ops_feed_correlation"
        assert event["pond_id"] == POND
        assert "overfeeding_confidence" in event
        assert "contributing_signals" in event
        assert "timestamp" in event

    def test_below_threshold_single_signal_never_dispatches(self):
        fog = OpsFog()
        feed_flat_baseline(fog, [0, 10, 20])
        fog.on_reading(reading("ammonia-nh3-total", 0.2, 0))
        events = fog.on_reading(reading("ammonia-nh3-total", 0.8, 30))
        assert events == []


class TestRawSignalContextFields:
    def test_event_carries_latest_raw_value_for_every_signal_seen_so_far(self):
        fog = OpsFog()
        feed_flat_baseline(fog, [0, 10, 20])
        fog.on_reading(reading("ammonia-nh3-total", 0.2, 0))
        fog.on_reading(reading("turbidity", 10.0, 0))
        fog.on_reading(reading("ammonia-nh3-total", 0.8, 30))
        # turbidity is the signal that crosses the dispatch threshold here (2 signals = 0.5)
        events = fog.on_reading(reading("turbidity", 40.0, 30))
        event = events[0]
        assert event["feeder_load_cell"] == 100.0
        assert event["ammonia_nh3_total"] == 0.8
        assert event["turbidity"] == 40.0
        assert event["orp"] is None

    def test_context_field_absent_when_that_signal_never_reported(self):
        fog = OpsFog()
        feed_flat_baseline(fog, [0, 10, 20])
        fog.on_reading(reading("ammonia-nh3-total", 0.2, 0))
        fog.on_reading(reading("turbidity", 10.0, 0))
        fog.on_reading(reading("ammonia-nh3-total", 0.8, 30))
        events = fog.on_reading(reading("turbidity", 40.0, 30))
        assert events[0]["orp"] is None
