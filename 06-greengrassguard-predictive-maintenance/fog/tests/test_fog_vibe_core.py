import math

import pytest

from fog_vibe_core import (
    VibeCore,
    WINDOW_SIZE,
    ACOUSTIC_ADVISORY_THRESHOLD_DB,
    ACOUSTIC_CORROBORATION_THRESHOLD_DB,
)


def make_reading(asset_id, metric, window, timestamp='2026-01-01T00:00:00Z'):
    return {
        'assetId': asset_id,
        'metric': metric,
        'value': window[-1],
        'unit': 'mm/s',
        'timestamp': timestamp,
        'window': window,
    }


def sine_window(freq_hz, sample_rate_hz, n, amplitude=1.0):
    return [amplitude * math.sin(2 * math.pi * freq_hz * i / sample_rate_hz) for i in range(n)]


class FakeDispatcher:
    def __init__(self):
        self.events = []

    def dispatch(self, event):
        self.events.append(event)
        return True


def test_band_energy_places_dominant_frequency_in_expected_band():
    core = VibeCore()
    sample_rate = 64.0
    # rfft of a 32-sample window has 17 bins; a high frequency near Nyquist
    # should dominate the top third (high band) of the spectrum.
    window = sine_window(freq_hz=28.0, sample_rate_hz=sample_rate, n=WINDOW_SIZE, amplitude=5.0)

    _, energies = core._band_energies(window)

    assert energies['high'] > energies['low']
    assert energies['high'] > energies['mid']


def test_band_energy_low_frequency_dominates_low_band():
    core = VibeCore()
    sample_rate = 64.0
    window = sine_window(freq_hz=2.0, sample_rate_hz=sample_rate, n=WINDOW_SIZE, amplitude=5.0)

    _, energies = core._band_energies(window)

    assert energies['low'] > energies['mid']
    assert energies['low'] > energies['high']


def test_ewma_baseline_seeds_on_first_window_then_settles():
    core = VibeCore()
    asset_id = 'asset-01'
    metric = 'vibe-axial'
    quiet_window = [0.1] * WINDOW_SIZE

    core.on_reading(make_reading(asset_id, metric, quiet_window))
    key = (asset_id, metric)
    first_baseline = dict(core._baselines[key])
    assert all(v is not None for v in first_baseline.values())

    # anomaly score should be ~0 right after seeding since baseline == current energy
    core.on_reading(make_reading(asset_id, metric, quiet_window))
    second_baseline = core._baselines[key]
    for band in ('low', 'mid', 'high'):
        assert second_baseline[band] == pytest.approx(first_baseline[band], rel=1e-6)


def test_single_breach_does_not_dispatch():
    core = VibeCore()
    asset_id = 'asset-02'
    metric = 'vibe-radial'
    quiet_window = [0.05] * WINDOW_SIZE
    loud_window = sine_window(freq_hz=2.0, sample_rate_hz=64.0, n=WINDOW_SIZE, amplitude=50.0)

    # seed baseline with several quiet windows so EWMA is stable and low
    for _ in range(5):
        events = core.on_reading(make_reading(asset_id, metric, quiet_window))
        assert events == []

    events = core.on_reading(make_reading(asset_id, metric, loud_window))
    assert events == []


def test_two_consecutive_breaches_dispatch_with_top3_bands():
    core = VibeCore()
    asset_id = 'asset-03'
    metric = 'vibe-axial'
    quiet_window = [0.05] * WINDOW_SIZE
    loud_window = sine_window(freq_hz=2.0, sample_rate_hz=64.0, n=WINDOW_SIZE, amplitude=50.0)

    for _ in range(5):
        core.on_reading(make_reading(asset_id, metric, quiet_window))

    first = core.on_reading(make_reading(asset_id, metric, loud_window))
    assert first == []

    second = core.on_reading(make_reading(asset_id, metric, loud_window))
    assert len(second) == 1

    event = second[0]
    assert event['type'] == 'vibe_fault'
    assert event['asset_id'] == asset_id
    assert event['metric'] == metric
    assert 1 <= len(event['fault_bands']) <= 3
    energies = [b['energy'] for b in event['fault_bands']]
    assert energies == sorted(energies, reverse=True)
    for band_entry in event['fault_bands']:
        assert band_entry['band'] in ('low', 'mid', 'high')
        assert 'anomaly_score' in band_entry
    assert 'window' not in event
    assert 'fft' not in event


def test_non_vibe_metric_returns_empty_list():
    core = VibeCore()
    reading = {
        'assetId': 'asset-01',
        'metric': 'thermal-winding',
        'value': 60.0,
        'unit': 'degC',
        'timestamp': '2026-01-01T00:00:00Z',
    }
    assert core.on_reading(reading) == []


def test_partial_window_does_not_compute_yet():
    core = VibeCore()
    reading = make_reading('asset-01', 'vibe-axial', [0.1] * 10)
    assert core.on_reading(reading) == []


def test_dispatch_uses_shared_dispatcher_contract():
    core = VibeCore()
    dispatcher = FakeDispatcher()
    asset_id = 'asset-04'
    metric = 'vibe-radial'
    quiet_window = [0.05] * WINDOW_SIZE
    loud_window = sine_window(freq_hz=2.0, sample_rate_hz=64.0, n=WINDOW_SIZE, amplitude=50.0)

    for _ in range(5):
        core.on_reading(make_reading(asset_id, metric, quiet_window))
    for reading_window in (loud_window, loud_window):
        for event in core.on_reading(make_reading(asset_id, metric, reading_window)):
            dispatcher.dispatch(event)

    assert len(dispatcher.events) == 1
    assert dispatcher.events[0]['type'] == 'vibe_fault'


def make_acoustic_reading(asset_id, db_level, timestamp='2026-01-01T00:00:00Z'):
    return {
        'assetId': asset_id,
        'metric': 'acoustic-emission',
        'value': db_level,
        'unit': 'dB',
        'timestamp': timestamp,
    }


def test_quiet_acoustic_emission_produces_no_event():
    core = VibeCore()
    events = core.on_reading(make_acoustic_reading('asset-05', ACOUSTIC_ADVISORY_THRESHOLD_DB - 1))
    assert events == []


def test_elevated_acoustic_emission_alone_raises_advisory():
    core = VibeCore()
    events = core.on_reading(make_acoustic_reading('asset-05', ACOUSTIC_ADVISORY_THRESHOLD_DB + 5))

    assert len(events) == 1
    event = events[0]
    assert event['type'] == 'acoustic_advisory'
    assert event['asset_id'] == 'asset-05'
    assert event['db_level'] == pytest.approx(ACOUSTIC_ADVISORY_THRESHOLD_DB + 5)


def test_vibe_fault_without_acoustic_corroboration_is_medium_severity():
    core = VibeCore()
    asset_id = 'asset-06'
    metric = 'vibe-axial'
    quiet_window = [0.05] * WINDOW_SIZE
    loud_window = sine_window(freq_hz=2.0, sample_rate_hz=64.0, n=WINDOW_SIZE, amplitude=50.0)

    for _ in range(5):
        core.on_reading(make_reading(asset_id, metric, quiet_window))

    core.on_reading(make_reading(asset_id, metric, loud_window))
    events = core.on_reading(make_reading(asset_id, metric, loud_window))

    assert len(events) == 1
    assert events[0]['severity'] == 'medium'
    assert events[0]['acoustic_corroborated'] is False


def test_vibe_fault_with_acoustic_corroboration_escalates_to_high_severity():
    core = VibeCore()
    asset_id = 'asset-07'
    metric = 'vibe-radial'
    quiet_window = [0.05] * WINDOW_SIZE
    loud_window = sine_window(freq_hz=2.0, sample_rate_hz=64.0, n=WINDOW_SIZE, amplitude=50.0)

    for _ in range(5):
        core.on_reading(make_reading(asset_id, metric, quiet_window))

    # an acoustic-emission spike lands between the two breaching vibration
    # windows, exactly as it would arrive on its own MQTT topic in production.
    core.on_reading(make_reading(asset_id, metric, loud_window))
    core.on_reading(make_acoustic_reading(asset_id, ACOUSTIC_CORROBORATION_THRESHOLD_DB + 2))
    events = core.on_reading(make_reading(asset_id, metric, loud_window))

    assert len(events) == 1
    assert events[0]['severity'] == 'high'
    assert events[0]['acoustic_corroborated'] is True
    # existing contract fields must still be present and unchanged in shape
    assert events[0]['type'] == 'vibe_fault'
    assert events[0]['asset_id'] == asset_id
    assert events[0]['metric'] == metric
    assert 1 <= len(events[0]['fault_bands']) <= 3
