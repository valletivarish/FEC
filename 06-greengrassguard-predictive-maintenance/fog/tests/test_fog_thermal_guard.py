import pytest

from fog_thermal_guard import ThermalGuard, WINDOW_SIZE, SLOPE_CONSECUTIVE_REQUIRED
from dispatcher import DiagnosisDispatcher


class FakeDispatcher(DiagnosisDispatcher):
    def __init__(self):
        self.events = []

    def dispatch(self, event):
        self.events.append(event)
        return True


def winding_reading(asset_id, value, timestamp='2026-01-01T00:00:00Z'):
    return {
        'assetId': asset_id,
        'metric': 'thermal-winding',
        'value': value,
        'unit': 'degC',
        'timestamp': timestamp,
    }


def current_reading(asset_id, value):
    return {'assetId': asset_id, 'metric': 'electrical-current-rms', 'value': value, 'unit': 'A', 'timestamp': 't'}


def rpm_reading(asset_id, value):
    return {'assetId': asset_id, 'metric': 'mech-rpm', 'value': value, 'unit': 'rpm', 'timestamp': 't'}


def test_bearing_current_rpm_readings_are_absorbed_without_events():
    guard = ThermalGuard()
    bearing_reading = {
        'assetId': 'asset-01', 'metric': 'thermal-bearing', 'value': 50, 'unit': 'degC', 'timestamp': 't',
    }
    assert guard.on_reading(bearing_reading) == []
    assert guard.on_reading(current_reading('asset-01', 10)) == []
    assert guard.on_reading(rpm_reading('asset-01', 1000)) == []


def test_runaway_requires_five_consecutive_high_slope_samples():
    guard = ThermalGuard()
    asset_id = 'asset-01'

    # fill window with a flat baseline first so slope starts near zero
    for _ in range(WINDOW_SIZE):
        events = guard.on_reading(winding_reading(asset_id, 40.0))
    assert events == []

    # now ramp steeply; each new sample keeps the window's slope high once
    # enough steep samples have flowed through, but not before 5 consecutive
    steep_values = [40.0 + i * 5.0 for i in range(1, 14)]
    fired_at = None
    for i, value in enumerate(steep_values):
        events = guard.on_reading(winding_reading(asset_id, value))
        tags = events[0]['verdict_tags'] if events else []
        if 'runaway' in tags:
            fired_at = i
            break

    assert fired_at is not None
    assert guard._slope_streak[asset_id] >= SLOPE_CONSECUTIVE_REQUIRED


def test_less_than_five_consecutive_high_slope_does_not_trigger_runaway():
    guard = ThermalGuard()
    asset_id = 'asset-02'

    for _ in range(WINDOW_SIZE):
        guard.on_reading(winding_reading(asset_id, 40.0))

    # only 3 steep samples then a flat one resets the streak
    for value in (42.0, 44.0, 46.0):
        events = guard.on_reading(winding_reading(asset_id, value))
        tags = events[0]['verdict_tags'] if events else []
        assert 'runaway' not in tags

    events = guard.on_reading(winding_reading(asset_id, 46.0))
    tags = events[0]['verdict_tags'] if events else []
    assert 'runaway' not in tags
    assert guard._slope_streak[asset_id] < SLOPE_CONSECUTIVE_REQUIRED


def test_sideband_requires_three_consecutive_deviating_samples():
    guard = ThermalGuard()
    asset_id = 'asset-03'

    guard.on_reading(current_reading(asset_id, 20))
    guard.on_reading(rpm_reading(asset_id, 1000))
    # expected_temp = 40 + 0.6*20 + 0.01*1000 = 62.0; deviation > 8 means winding > 70.0 or < 54.0

    events1 = guard.on_reading(winding_reading(asset_id, 90.0))
    assert 'sideband' not in (events1[0]['verdict_tags'] if events1 else [])

    events2 = guard.on_reading(winding_reading(asset_id, 90.0))
    assert 'sideband' not in (events2[0]['verdict_tags'] if events2 else [])

    events3 = guard.on_reading(winding_reading(asset_id, 90.0))
    assert events3
    assert 'sideband' in events3[0]['verdict_tags']
    assert events3[0]['deviation'] == pytest.approx(28.0)


def test_sideband_streak_resets_when_deviation_drops():
    guard = ThermalGuard()
    asset_id = 'asset-04'

    guard.on_reading(current_reading(asset_id, 20))
    guard.on_reading(rpm_reading(asset_id, 1000))

    guard.on_reading(winding_reading(asset_id, 90.0))
    guard.on_reading(winding_reading(asset_id, 90.0))
    # third sample back in range resets the streak before it fires
    events = guard.on_reading(winding_reading(asset_id, 62.0))
    assert 'sideband' not in (events[0]['verdict_tags'] if events else [])
    assert guard._deviation_streak[asset_id] == 0


def test_both_runaway_and_sideband_can_appear_together():
    guard = ThermalGuard()
    asset_id = 'asset-05'

    guard.on_reading(current_reading(asset_id, 20))
    guard.on_reading(rpm_reading(asset_id, 1000))
    # expected_temp = 62.0

    # build a rising window that also stays far above expected_temp
    base = 90.0
    for i in range(WINDOW_SIZE):
        guard.on_reading(winding_reading(asset_id, base + i * 3.0))

    events = None
    for i in range(6):
        value = base + (WINDOW_SIZE + i) * 3.0
        events = guard.on_reading(winding_reading(asset_id, value))
        if events and set(events[0]['verdict_tags']) == {'runaway', 'sideband'}:
            break

    assert events
    tags = events[0]['verdict_tags']
    assert 'runaway' in tags
    assert 'sideband' in tags


def test_dispatch_via_fake_dispatcher_receives_thermal_event_shape():
    guard = ThermalGuard()
    dispatcher = FakeDispatcher()
    asset_id = 'asset-06'

    guard.on_reading(current_reading(asset_id, 20))
    guard.on_reading(rpm_reading(asset_id, 1000))

    for _ in range(3):
        for event in guard.on_reading(winding_reading(asset_id, 90.0)):
            dispatcher.dispatch(event)

    assert len(dispatcher.events) == 1
    event = dispatcher.events[0]
    assert event['type'] == 'thermal_event'
    assert event['asset_id'] == asset_id
    assert 'verdict_tags' in event
    assert 'slope' in event
    assert 'deviation' in event
    assert 'timestamp' in event
