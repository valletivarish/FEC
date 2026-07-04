import pytest

import fog_pollution
from fog_pollution import PollutionFog


def make_reading(station_id, metric, value, timestamp='2026-01-01T00:00:00Z'):
    return {
        'stationId': station_id,
        'metric': metric,
        'value': value,
        'unit': '',
        'timestamp': timestamp,
    }


class TestP95Interpolation:
    def test_matches_hand_computed_reference_on_small_sorted_fixture(self):
        # index = 0.95*(10-1) = 8.55 -> interpolate between sorted[8]=33 and sorted[9]=40
        # 33 + (40-33)*0.55 = 36.85
        fixture = [40.0, 12.0, 28.0, 18.0, 33.0, 15.0, 22.0, 30.0, 20.0, 25.0]
        p95 = PollutionFog._percentile_95(fixture)

        assert p95 == pytest.approx(36.85, rel=1e-9)

    def test_no_dispatch_before_the_full_window_is_filled(self):
        fog = PollutionFog()
        station = 'station-quad'

        events = []
        for value in [10.0] * 19:
            events += fog.on_reading(make_reading(station, 'pm2-5', value))

        # only 19 samples so far, below WINDOW_SIZE=20; baseline/recent split isn't ready yet
        assert events == []

    def test_p95_is_tracked_independently_per_metric(self):
        fog = PollutionFog()
        station = 'station-quad'

        pm25_values = [10.0, 12.0, 11.0, 13.0, 12.0, 11.0, 14.0, 13.0, 12.0, 11.0]
        noise_values = [50.0, 52.0, 51.0, 53.0, 52.0, 51.0, 54.0, 53.0, 52.0, 51.0]

        for v in pm25_values:
            fog.on_reading(make_reading(station, 'pm2-5', v))
        for v in noise_values:
            fog.on_reading(make_reading(station, 'ambient-noise', v))

        pm25_window = list(fog._windows['pm2-5'][station])
        noise_window = list(fog._windows['ambient-noise'][station])

        assert pm25_window == pm25_values
        assert noise_window == noise_values


class TestExceedanceTransitionMechanics:
    def test_a_baseline_vs_recent_split_lets_most_of_the_recent_half_exceed(self):
        # p95 is computed from the OLDER 10 (baseline) and checked against the NEWER 10
        # (recent) -- a disjoint split, unlike comparing a window to its own percentile,
        # which caps exceedances at ~1 by construction (p95 always sits between the top
        # two order statistics of the SAME set it's computed from).
        fog = PollutionFog()
        station = 'station-quad'

        for v in [10.0] * 10 + [500.0] * 10:
            fog.on_reading(make_reading(station, 'pm2-5', v))

        window = list(fog._windows['pm2-5'][station])
        baseline, recent = window[:10], window[10:]
        p95 = PollutionFog._percentile_95(baseline)
        expected_count = sum(1 for v in recent if v > p95)

        assert expected_count == 10

    def test_dispatches_on_rising_edge_when_threshold_is_reached(self):
        fog = PollutionFog()
        station = 'station-quad'

        events = []
        for v in [10.0] * 10:
            events += fog.on_reading(make_reading(station, 'pm2-5', v))
        assert events == []

        for v in [500.0] * 9:
            events += fog.on_reading(make_reading(station, 'pm2-5', v))
        assert events == []

        events = fog.on_reading(make_reading(station, 'pm2-5', 500.0))

        assert len(events) == 1
        event = events[0]
        assert event['type'] == 'pollution_event'
        assert event['station_id'] == station
        assert event['metric'] == 'pm2-5'
        assert event['exceedance_count'] >= fog_pollution.EXCEEDANCE_THRESHOLD
        assert set(event.keys()) == {
            'type', 'station_id', 'metric', 'rolling_p95', 'exceedance_count', 'timestamp',
        }

    def test_does_not_redispatch_while_still_exceeding(self):
        fog = PollutionFog()
        station = 'station-quad'

        for v in [10.0] * 10 + [500.0] * 9:
            fog.on_reading(make_reading(station, 'pm2-5', v))
        first = fog.on_reading(make_reading(station, 'pm2-5', 500.0))
        second = fog.on_reading(make_reading(station, 'pm2-5', 500.0))

        assert len(first) == 1
        assert len(second) == 0

    def test_pm25_and_ambient_noise_transitions_are_independent(self):
        fog = PollutionFog()
        station = 'station-quad'

        for v in [10.0] * 10 + [500.0] * 9:
            fog.on_reading(make_reading(station, 'pm2-5', v))
        pm25_events = fog.on_reading(make_reading(station, 'pm2-5', 500.0))
        assert len(pm25_events) == 1
        assert pm25_events[0]['metric'] == 'pm2-5'

        # ambient-noise has no samples yet, so it must not have any transition state polluted
        for v in [30.0] * 10 + [100.0] * 9:
            fog.on_reading(make_reading(station, 'ambient-noise', v))
        noise_events = fog.on_reading(make_reading(station, 'ambient-noise', 100.0))

        assert len(noise_events) == 1
        assert noise_events[0]['metric'] == 'ambient-noise'

    def test_unrelated_metric_returns_no_events(self):
        fog = PollutionFog()
        events = fog.on_reading(make_reading('station-quad', 'uv-index', 5.0))
        assert events == []
