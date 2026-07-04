from datetime import datetime, timedelta

from fog.fog_life_support import LifeSupportFog
from fog.tests.fakes import RecordingDispatcher

POND = "pond-01"
BASE_TIME = datetime(2026, 1, 1, 8, 0, 0)


def ts(minute_offset: int) -> str:
    return (BASE_TIME + timedelta(minutes=minute_offset)).isoformat() + "Z"


def do_reading(value: float, minute_offset: int, pond=POND) -> dict:
    return {
        "pondId": pond, "metric": "dissolved-oxygen", "value": value, "unit": "mg/L", "timestamp": ts(minute_offset)
    }


def temp_reading(value: float, minute_offset: int, pond=POND) -> dict:
    return {
        "pondId": pond, "metric": "water-temperature", "value": value, "unit": "degC", "timestamp": ts(minute_offset)
    }


def level_reading(value: float, minute_offset: int, pond=POND) -> dict:
    return {"pondId": pond, "metric": "water-level", "value": value, "unit": "cm", "timestamp": ts(minute_offset)}


def dispatch_all(fog: LifeSupportFog, dispatcher: RecordingDispatcher, reading: dict):
    for event in fog.on_reading(reading):
        dispatcher.dispatch(event)


class TestStageThresholds:
    def test_no_alert_when_do_healthy(self):
        fog = LifeSupportFog()
        events = fog.on_reading(do_reading(6.0, 0))
        assert events == []

    def test_stage1_warning_below_4(self):
        fog = LifeSupportFog()
        events = fog.on_reading(do_reading(3.8, 0))
        assert len(events) == 1
        assert events[0]["stage"] == "hypoxia_warning"
        assert events[0]["pond_id"] == POND
        assert events[0]["type"] == "life_support"

    def test_stage2_critical_below_3(self):
        fog = LifeSupportFog()
        events = fog.on_reading(do_reading(2.5, 0))
        assert len(events) == 1
        assert events[0]["stage"] == "hypoxia_critical"

    def test_stage2_critical_from_steep_negative_rate_of_change(self):
        fog = LifeSupportFog()
        # dropping at -0.6 mg/L/min while still well above the 4.0 value threshold, so only the
        # rate-of-change trigger (not the absolute value) can explain a critical stage this early
        values = [6.5, 5.9, 5.3, 4.7, 4.1]
        all_events = []
        for i, v in enumerate(values):
            all_events.extend(fog.on_reading(do_reading(v, i)))
        critical_events = [e for e in all_events if e["stage"] == "hypoxia_critical"]
        assert critical_events
        assert critical_events[0]["dissolved_oxygen"] >= 4.0
        assert critical_events[0]["rate_of_change"] <= -0.5

    def test_clears_when_do_recovers(self):
        fog = LifeSupportFog()
        fog.on_reading(do_reading(3.8, 0))
        events = fog.on_reading(do_reading(6.0, 1))
        assert len(events) == 1
        assert events[0]["stage"] == "cleared"

    def test_stage_transition_warning_to_critical_dispatches_new_event(self):
        fog = LifeSupportFog()
        fog.on_reading(do_reading(3.8, 0))
        events = fog.on_reading(do_reading(2.0, 1))
        assert len(events) == 1
        assert events[0]["stage"] == "hypoxia_critical"


class TestTemperatureCompensation:
    def test_warm_water_tightens_warning_threshold(self):
        fog = LifeSupportFog()
        fog.on_reading(temp_reading(29.0, 0))
        # 4.2 is below the tightened 4.5 threshold but above the untightened 4.0
        events = fog.on_reading(do_reading(4.2, 1))
        assert len(events) == 1
        assert events[0]["stage"] == "hypoxia_warning"

    def test_same_value_no_alert_when_water_cool(self):
        fog = LifeSupportFog()
        fog.on_reading(temp_reading(22.0, 0))
        events = fog.on_reading(do_reading(4.2, 1))
        assert len(events) == 0

    def test_warm_water_tightens_critical_threshold(self):
        fog = LifeSupportFog()
        fog.on_reading(temp_reading(30.0, 0))
        # 3.2 is below tightened critical 3.5 but above base critical 3.0
        events = fog.on_reading(do_reading(3.2, 1))
        assert len(events) == 1
        assert events[0]["stage"] == "hypoxia_critical"

    def test_exactly_at_boundary_not_warm(self):
        fog = LifeSupportFog()
        fog.on_reading(temp_reading(28.0, 0))
        events = fog.on_reading(do_reading(4.2, 1))
        assert events == []


class TestProbeExposedSuppression:
    def test_low_water_level_suppresses_alarm(self):
        fog = LifeSupportFog()
        fog.on_reading(level_reading(20.0, 0))
        events = fog.on_reading(do_reading(1.0, 1))
        assert events == []

    def test_water_level_above_threshold_allows_alarm(self):
        fog = LifeSupportFog()
        fog.on_reading(level_reading(50.0, 0))
        events = fog.on_reading(do_reading(1.0, 1))
        assert len(events) == 1
        assert events[0]["stage"] == "hypoxia_critical"

    def test_water_level_exactly_at_30_does_not_suppress(self):
        fog = LifeSupportFog()
        fog.on_reading(level_reading(30.0, 0))
        events = fog.on_reading(do_reading(1.0, 1))
        assert len(events) == 1


class TestWaterLevelContextField:
    def test_event_carries_latest_water_level(self):
        fog = LifeSupportFog()
        fog.on_reading(level_reading(120.0, 0))
        events = fog.on_reading(do_reading(2.5, 1))
        assert len(events) == 1
        assert events[0]["water_level"] == 120.0

    def test_water_level_absent_when_never_reported(self):
        fog = LifeSupportFog()
        events = fog.on_reading(do_reading(2.5, 0))
        assert len(events) == 1
        assert events[0]["water_level"] is None


class TestReDispatchBehavior:
    def test_redispatches_every_30_ticks_capped_at_10(self):
        fog = LifeSupportFog()
        dispatcher = RecordingDispatcher()

        # first tick establishes the critical stage
        dispatch_all(fog, dispatcher, do_reading(1.0, 0))
        assert len(dispatcher.dispatched) == 1

        # feed 30-tick intervals of readings that keep the same stage active (still critical)
        minute = 1
        for _ in range(10):
            for _ in range(29):
                dispatch_all(fog, dispatcher, do_reading(1.0, minute))
                minute += 1
            dispatch_all(fog, dispatcher, do_reading(1.0, minute))
            minute += 1

        # 1 initial dispatch + 10 capped re-dispatches = 11 total
        assert len(dispatcher.dispatched) == 11

        # further re-dispatch-eligible ticks should not add more once capped
        for _ in range(30):
            dispatch_all(fog, dispatcher, do_reading(1.0, minute))
            minute += 1
        assert len(dispatcher.dispatched) == 11

    def test_no_redispatch_before_30_ticks(self):
        fog = LifeSupportFog()
        dispatcher = RecordingDispatcher()
        dispatch_all(fog, dispatcher, do_reading(1.0, 0))
        assert len(dispatcher.dispatched) == 1
        for i in range(1, 29):
            dispatch_all(fog, dispatcher, do_reading(1.0, i))
        assert len(dispatcher.dispatched) == 1
