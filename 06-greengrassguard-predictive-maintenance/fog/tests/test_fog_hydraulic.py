import pytest

from fog_hydraulic import (
    HydraulicFog,
    COMMISSIONING_BASELINE_BAR,
    CAVITATION_PRESSURE_RATIO,
    HUMID_CAVITATION_PRESSURE_RATIO,
    HIGH_HUMIDITY_THRESHOLD_PCT,
)
from dispatcher import DiagnosisDispatcher


class FakeDispatcher(DiagnosisDispatcher):
    def __init__(self):
        self.events = []

    def dispatch(self, event):
        self.events.append(event)
        return True


def flow_reading(asset_id, value):
    return {'assetId': asset_id, 'metric': 'hydraulic-flow', 'value': value, 'unit': 'm3/h', 'timestamp': 't'}


def current_reading(asset_id, value):
    return {'assetId': asset_id, 'metric': 'electrical-current-rms', 'value': value, 'unit': 'A', 'timestamp': 't'}


def pressure_reading(asset_id, value, timestamp='t'):
    return {
        'assetId': asset_id, 'metric': 'hydraulic-discharge-pressure',
        'value': value, 'unit': 'bar', 'timestamp': timestamp,
    }


def humidity_reading(asset_id, value):
    return {'assetId': asset_id, 'metric': 'env-humidity', 'value': value, 'unit': '%RH', 'timestamp': 't'}


def test_pressure_reading_without_flow_or_current_returns_nothing():
    fog = HydraulicFog()
    assert fog.on_reading(pressure_reading('asset-01', 8.0)) == []


def test_efficiency_formula_hand_computed():
    fog = HydraulicFog()
    asset_id = 'asset-01'
    fog.on_reading(current_reading(asset_id, 10.0))
    fog.on_reading(flow_reading(asset_id, 100.0))

    # eta = (pressure * flow) / (current * 12.0) = (0.5 * 100.0) / (10.0 * 12.0) = 0.41666...
    # kept below the low-efficiency threshold so the dispatch fires on
    # efficiency alone, letting the hand-computed value be asserted directly
    events = fog.on_reading(pressure_reading(asset_id, 0.5))

    assert len(events) == 1
    event = events[0]
    assert event['efficiency'] == pytest.approx(50.0 / 120.0)
    assert event['efficiency'] < 0.5
    assert event['cavitation_suspected'] is False


def test_low_efficiency_alone_triggers_dispatch():
    fog = HydraulicFog()
    asset_id = 'asset-02'
    fog.on_reading(current_reading(asset_id, 50.0))
    fog.on_reading(flow_reading(asset_id, 10.0))

    # eta = (5.0 * 10.0) / (50.0 * 12.0) = 0.0833... well below 0.5
    events = fog.on_reading(pressure_reading(asset_id, 5.0))

    assert len(events) == 1
    assert events[0]['efficiency'] < 0.5
    assert events[0]['cavitation_suspected'] is False


def test_high_efficiency_and_no_cavitation_does_not_dispatch():
    fog = HydraulicFog()
    asset_id = 'asset-03'
    fog.on_reading(current_reading(asset_id, 5.0))
    for _ in range(20):
        fog.on_reading(flow_reading(asset_id, 100.0))

    # eta = (9.0 * 100.0) / (5.0 * 12.0) = 15.0, well above threshold; flow_cv = 0
    events = fog.on_reading(pressure_reading(asset_id, 9.0))
    assert events == []


def test_high_flow_cv_alone_does_not_trigger_cavitation():
    fog = HydraulicFog()
    asset_id = 'asset-04'
    fog.on_reading(current_reading(asset_id, 5.0))
    # highly variable flow -> CV > 0.15
    for value in [50.0, 150.0, 40.0, 160.0, 30.0]:
        fog.on_reading(flow_reading(asset_id, value))

    # pressure kept high (above 7.0 bar), so cavitation condition #2 fails
    events = fog.on_reading(pressure_reading(asset_id, 9.0))

    if events:
        assert events[0]['cavitation_suspected'] is False


def test_low_pressure_alone_does_not_trigger_cavitation():
    fog = HydraulicFog()
    asset_id = 'asset-05'
    fog.on_reading(current_reading(asset_id, 5.0))
    # steady flow -> low CV
    for _ in range(20):
        fog.on_reading(flow_reading(asset_id, 100.0))

    # pressure below 7.0 bar but flow CV is ~0, so condition #1 fails
    events = fog.on_reading(pressure_reading(asset_id, 5.0))

    if events:
        assert events[0]['cavitation_suspected'] is False


def test_high_flow_cv_and_low_pressure_together_trigger_cavitation():
    fog = HydraulicFog()
    asset_id = 'asset-06'
    fog.on_reading(current_reading(asset_id, 5.0))
    for value in [50.0, 150.0, 40.0, 160.0, 30.0]:
        fog.on_reading(flow_reading(asset_id, value))

    # pressure below 7.0 bar (70% of 10.0 baseline) AND high flow CV
    events = fog.on_reading(pressure_reading(asset_id, 5.0))

    assert len(events) == 1
    event = events[0]
    assert event['cavitation_suspected'] is True
    assert event['flow_cv'] > 0.15
    assert event['pressure'] == 5.0


def test_dispatch_via_fake_dispatcher_receives_hydraulic_event_shape():
    fog = HydraulicFog()
    dispatcher = FakeDispatcher()
    asset_id = 'asset-07'
    fog.on_reading(current_reading(asset_id, 5.0))
    for value in [50.0, 150.0, 40.0, 160.0, 30.0]:
        fog.on_reading(flow_reading(asset_id, value))

    for event in fog.on_reading(pressure_reading(asset_id, 5.0)):
        dispatcher.dispatch(event)

    assert len(dispatcher.events) == 1
    event = dispatcher.events[0]
    assert event['type'] == 'hydraulic_event'
    assert event['asset_id'] == asset_id
    assert 'efficiency' in event
    assert 'cavitation_suspected' in event
    assert 'flow_cv' in event
    assert 'pressure' in event
    assert 'timestamp' in event


def test_marginal_pressure_with_erratic_flow_does_not_trigger_cavitation_when_dry():
    fog = HydraulicFog()
    asset_id = 'asset-08'
    fog.on_reading(current_reading(asset_id, 5.0))
    fog.on_reading(humidity_reading(asset_id, HIGH_HUMIDITY_THRESHOLD_PCT - 10))
    for value in [50.0, 150.0, 40.0, 160.0, 30.0]:
        fog.on_reading(flow_reading(asset_id, value))

    # 8.0 bar sits between the dry ratio (7.0) and humid ratio (8.5) thresholds,
    # so a dry environment must not flag cavitation on this pressure alone.
    marginal_pressure = COMMISSIONING_BASELINE_BAR * (CAVITATION_PRESSURE_RATIO + 0.03)
    events = fog.on_reading(pressure_reading(asset_id, marginal_pressure))

    if events:
        assert events[0]['cavitation_suspected'] is False
    assert fog._latest_humidity[asset_id] < HIGH_HUMIDITY_THRESHOLD_PCT


def test_marginal_pressure_with_erratic_flow_triggers_cavitation_when_humid():
    fog = HydraulicFog()
    asset_id = 'asset-09'
    fog.on_reading(current_reading(asset_id, 5.0))
    fog.on_reading(humidity_reading(asset_id, HIGH_HUMIDITY_THRESHOLD_PCT + 5))
    for value in [50.0, 150.0, 40.0, 160.0, 30.0]:
        fog.on_reading(flow_reading(asset_id, value))

    # same marginal pressure as the dry test, but high ambient humidity relaxes
    # the ratio to 8.5 bar, so this same reading now crosses the humid threshold.
    marginal_pressure = COMMISSIONING_BASELINE_BAR * (CAVITATION_PRESSURE_RATIO + 0.03)
    assert marginal_pressure < COMMISSIONING_BASELINE_BAR * HUMID_CAVITATION_PRESSURE_RATIO

    events = fog.on_reading(pressure_reading(asset_id, marginal_pressure))

    assert len(events) == 1
    event = events[0]
    assert event['cavitation_suspected'] is True
    assert event['humid_environment'] is True
    assert event['humidity_pct'] == pytest.approx(HIGH_HUMIDITY_THRESHOLD_PCT + 5)


def test_hydraulic_event_carries_humidity_context_even_without_reading():
    fog = HydraulicFog()
    asset_id = 'asset-10'
    fog.on_reading(current_reading(asset_id, 50.0))
    fog.on_reading(flow_reading(asset_id, 10.0))

    events = fog.on_reading(pressure_reading(asset_id, 5.0))

    assert len(events) == 1
    assert events[0]['humidity_pct'] is None
    assert events[0]['humid_environment'] is False
