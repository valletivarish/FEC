import pytest

from fog_safety import SafetyFog

VESSEL_ID = 'vessel-03'


def _bilge_reading(level, timestamp='2026-07-01T00:00:00Z'):
    return {
        'vesselId': VESSEL_ID,
        'metric': 'hull-bilge-level',
        'value': level,
        'unit': 'mm',
        'timestamp': timestamp,
    }


def _gps_reading(lat, lon, timestamp='2026-07-01T00:00:00Z'):
    return {
        'vesselId': VESSEL_ID,
        'metric': 'nav-gps',
        'value': {'lat': lat, 'lon': lon},
        'unit': 'deg',
        'timestamp': timestamp,
    }


def _heading_reading(heading_deg, timestamp='2026-07-01T00:00:00Z'):
    return {
        'vesselId': VESSEL_ID,
        'metric': 'nav-heading',
        'value': heading_deg,
        'unit': 'deg',
        'timestamp': timestamp,
    }


def test_no_slope_computed_before_three_samples_so_no_alarm_from_slope():
    fog = SafetyFog()
    fog.on_reading(_bilge_reading(10))
    events = fog.on_reading(_bilge_reading(20))

    assert events == []


def test_ols_slope_matches_hand_computed_reference():
    fog = SafetyFog()
    levels = [10, 20, 35, 55]  # OLS slope against index 0..3 = 15.0 (see spec derivation)

    events = []
    for level in levels:
        events = fog.on_reading(_bilge_reading(level))

    assert events[0]['slope'] == pytest.approx(15.0)


def test_alarm_triggers_on_rising_slope_and_dispatches_every_reading_while_active():
    fog = SafetyFog()
    levels = [10, 20, 35, 55, 60, 65]  # slope > 10 from the 4th reading onward

    all_events = []
    for level in levels:
        all_events.append(fog.on_reading(_bilge_reading(level)))

    active_flags = [len(e) > 0 for e in all_events]
    assert active_flags[:3] == [False, False, True]
    assert all(len(e) > 0 for e in all_events[3:])
    assert all(e[0]['alarmActive'] is True for e in all_events[2:])


def test_alarm_triggers_on_absolute_high_water_mark_even_with_flat_slope():
    fog = SafetyFog()
    fog.on_reading(_bilge_reading(160))
    fog.on_reading(_bilge_reading(160))
    events = fog.on_reading(_bilge_reading(160))

    assert events[0]['alarmActive'] is True


def test_alarm_clears_with_single_final_event_then_stops_dispatching():
    fog = SafetyFog()
    levels = [10, 20, 35, 55]  # triggers alarm via slope
    for level in levels:
        fog.on_reading(_bilge_reading(level))

    # bring the window back to flat/low values so neither condition holds
    clear_events = fog.on_reading(_bilge_reading(55))
    clear_events2 = fog.on_reading(_bilge_reading(55))
    clear_events3 = fog.on_reading(_bilge_reading(55))
    clear_events4 = fog.on_reading(_bilge_reading(55))

    all_clear_batches = [clear_events, clear_events2, clear_events3, clear_events4]
    trues = [b for b in all_clear_batches if len(b) > 0 and b[0]['alarmActive'] is False]
    assert len(trues) == 1  # exactly one final clear event across the settling readings

    after_clear = fog.on_reading(_bilge_reading(55))
    assert after_clear == []


def test_haversine_matches_known_reference_distance():
    fog = SafetyFog()
    # two points separated by exactly 0.01 degrees latitude ~ 1111.95m
    distance = fog._haversine(53.34, -6.28, 53.35, -6.28)

    assert distance == pytest.approx(1111.95, abs=1.0)


def test_first_gps_reading_always_records_unconditionally():
    fog = SafetyFog()
    events = fog.on_reading(_gps_reading(53.345, -6.26))

    assert len(events) == 1
    assert events[0]['type'] == 'gps_track_event'
    assert events[0]['lat'] == 53.345


def test_gps_decimation_normal_threshold_is_twelve_ticks():
    fog = SafetyFog()
    fog.on_reading(_gps_reading(53.345, -6.26))  # first reading records unconditionally, tick reset to 0

    dispatched = []
    for _ in range(12):
        events = fog.on_reading(_gps_reading(53.345, -6.26))  # zero movement, stays under distance trigger
        dispatched.append(len(events) > 0)

    assert dispatched == [False] * 11 + [True]  # 12th subsequent reading is the tick that hits the threshold


def test_gps_decimation_shortens_to_one_tick_while_alarm_active():
    fog = SafetyFog()
    fog.on_reading(_gps_reading(53.345, -6.26))

    for level in [10, 20, 35, 55]:  # trip the alarm via slope
        fog.on_reading(_bilge_reading(level))

    events = fog.on_reading(_gps_reading(53.345, -6.26))  # zero movement, but alarm active -> tick threshold 1
    assert len(events) == 1


def test_gps_distance_trigger_records_before_tick_threshold_reached():
    fog = SafetyFog()
    fog.on_reading(_gps_reading(53.34, -6.28))

    events = fog.on_reading(_gps_reading(53.35, -6.28))  # ~1112m >= 25m threshold
    assert len(events) == 1
    assert events[0]['lat'] == 53.35


def test_gps_track_event_carries_latest_heading_or_null():
    fog = SafetyFog()
    events_no_heading = fog.on_reading(_gps_reading(53.345, -6.26))
    assert events_no_heading[0]['headingDeg'] is None

    fog.on_reading(_heading_reading(88.0))
    events = fog.on_reading(_gps_reading(53.35, -6.28))
    assert events[0]['headingDeg'] == 88.0


def test_heading_reading_never_dispatches():
    fog = SafetyFog()
    events = fog.on_reading(_heading_reading(45.0))
    assert events == []
