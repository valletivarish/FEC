import math
import random

import numpy as np
import pytest

from fog_engine import EngineFog, WINDOW_SIZE, SAMPLE_RATE_HZ

VESSEL_ID = 'vessel-01'


def _vibration_reading(value, timestamp='2026-07-01T00:00:00Z'):
    return {
        'vesselId': VESSEL_ID,
        'metric': 'engine-vibration-raw',
        'value': value,
        'unit': 'g',
        'timestamp': timestamp,
    }


def _feed_window(fog, values):
    events = []
    for v in values:
        events = fog.on_reading(_vibration_reading(v))
    return events


def test_rms_matches_hand_computed_reference_on_alternating_fixture():
    fog = EngineFog()
    samples = [2.0, -2.0] * (WINDOW_SIZE // 2)

    events = _feed_window(fog, samples)

    assert len(events) == 1
    assert events[0]['rms'] == pytest.approx(2.0, abs=1e-9)


def test_bearing_wear_energy_concentrates_in_band_for_known_frequency_component():
    fog_signal = EngineFog()
    fog_control = EngineFog()

    t = np.arange(WINDOW_SIZE) / SAMPLE_RATE_HZ
    injected = list(2.0 * np.sin(2 * math.pi * 15 * t))  # 15Hz sits inside the 10-20Hz band
    control = [1.0 if i % 2 == 0 else -1.0 for i in range(WINDOW_SIZE)]  # no 10-20Hz content

    signal_events = _feed_window(fog_signal, injected)
    control_events = _feed_window(fog_control, control)

    signal_energy = signal_events[0]['bearingWearEnergy']
    control_energy = control_events[0]['bearingWearEnergy']

    assert signal_energy > 1.0
    assert signal_energy > control_energy * 1000


def test_degraded_bearing_never_trips_before_baseline_has_ten_samples():
    fog = EngineFog()
    rng = random.Random(7)

    for cycle in range(9):
        samples = [rng.uniform(-0.05, 0.05) for _ in range(WINDOW_SIZE)]
        events = _feed_window(fog, samples)
        assert events[0]['degradedBearing'] is False


def test_degraded_bearing_does_not_trip_on_stable_low_noise():
    fog = EngineFog()
    rng = random.Random(11)

    last_event = None
    for cycle in range(20):
        samples = [rng.uniform(-0.05, 0.05) for _ in range(WINDOW_SIZE)]
        last_event = _feed_window(fog, samples)[0]

    assert last_event['degradedBearing'] is False


def test_degraded_bearing_trips_after_injected_spike_past_baseline():
    fog = EngineFog()
    rng = random.Random(11)

    for cycle in range(15):
        samples = [rng.uniform(-0.05, 0.05) for _ in range(WINDOW_SIZE)]
        _feed_window(fog, samples)

    t = np.arange(WINDOW_SIZE) / SAMPLE_RATE_HZ
    spike_samples = list(3.5 * np.sin(2 * math.pi * 15 * t))
    spike_event = _feed_window(fog, spike_samples)[0]

    assert spike_event['degradedBearing'] is True


def test_window_resets_after_completion_non_overlapping():
    fog = EngineFog()
    samples = [0.1] * WINDOW_SIZE

    first_events = _feed_window(fog, samples)
    assert len(first_events) == 1

    partial_events = []
    for v in [0.2] * (WINDOW_SIZE - 1):
        partial_events = fog.on_reading(_vibration_reading(v))
    assert partial_events == []


def test_other_engine_metrics_never_dispatch_but_update_context():
    fog = EngineFog()

    assert fog.on_reading({
        'vesselId': VESSEL_ID, 'metric': 'engine-rpm', 'value': 2200,
        'unit': 'rpm', 'timestamp': 't',
    }) == []
    assert fog.on_reading({
        'vesselId': VESSEL_ID, 'metric': 'engine-coolant-temp', 'value': 82.5,
        'unit': 'degC', 'timestamp': 't',
    }) == []
    assert fog.on_reading({
        'vesselId': VESSEL_ID, 'metric': 'engine-oil-pressure', 'value': 410.0,
        'unit': 'kPa', 'timestamp': 't',
    }) == []
    assert fog.on_reading({
        'vesselId': VESSEL_ID, 'metric': 'engine-fuel-flow', 'value': 12.4,
        'unit': 'L/h', 'timestamp': 't',
    }) == []

    events = _feed_window(fog, [0.0] * WINDOW_SIZE)

    assert events[0]['engineRpm'] == 2200
    assert events[0]['coolantTempC'] == 82.5
    assert events[0]['oilPressureKpa'] == 410.0
    assert events[0]['fuelFlowLph'] == 12.4


def test_dispatched_event_never_contains_raw_samples():
    fog = EngineFog()
    events = _feed_window(fog, [0.3] * WINDOW_SIZE)

    assert 'samples' not in events[0]
    assert 'window' not in events[0]
    assert set(events[0].keys()) == {
        'type', 'vesselId', 'rms', 'bearingWearEnergy', 'degradedBearing',
        'engineRpm', 'coolantTempC', 'oilPressureKpa', 'fuelFlowLph', 'timestamp',
    }
