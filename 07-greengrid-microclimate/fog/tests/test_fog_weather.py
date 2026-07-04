import pytest

from fog_weather import WeatherFog


def make_reading(station_id, metric, value, timestamp='2026-01-01T00:00:00Z'):
    return {
        'stationId': station_id,
        'metric': metric,
        'value': value,
        'unit': '',
        'timestamp': timestamp,
    }


def feed_wind_pressure(fog, station_id, speed, direction, pressure, count):
    events = []
    for _ in range(count):
        events += fog.on_reading(make_reading(station_id, 'wind-speed', speed))
        events += fog.on_reading(make_reading(station_id, 'wind-direction', direction))
        events += fog.on_reading(make_reading(station_id, 'barometric-pressure', pressure))
    return events


class TestWindVectorAveraging:
    def test_wraparound_directions_average_near_zero_not_180(self):
        fog = WeatherFog()
        station = 'station-quad'

        # 350deg and 10deg straddle the 0/360 boundary; naive mean would be 180
        fog.on_reading(make_reading(station, 'wind-speed', 10.0))
        fog.on_reading(make_reading(station, 'wind-direction', 350.0))
        fog.on_reading(make_reading(station, 'wind-speed', 10.0))
        fog.on_reading(make_reading(station, 'wind-direction', 10.0))

        speed, direction = fog._vector_average_wind(fog._wind_windows[station])

        assert direction == pytest.approx(0.0, abs=1e-6) or direction == pytest.approx(360.0, abs=1e-6)
        assert speed == pytest.approx(9.84807753, rel=1e-6)
        # a naive arithmetic mean of degrees would give ~180, which is the opposite direction
        assert abs(direction - 180.0) > 90.0

    def test_speed_and_direction_only_paired_when_both_present(self):
        fog = WeatherFog()
        station = 'station-north-lawn'

        # a lone speed reading with no matching direction must not enter the window yet
        fog.on_reading(make_reading(station, 'wind-speed', 15.0))
        assert station not in fog._wind_windows or len(fog._wind_windows.get(station, [])) == 0

        fog.on_reading(make_reading(station, 'wind-direction', 90.0))
        assert len(fog._wind_windows[station]) == 1
        assert fog._wind_windows[station][0] == (15.0, 90.0)


class TestBarometricSlope:
    def test_slope_matches_hand_computed_linear_regression(self):
        fog = WeatherFog()
        pressures = [1010, 1008, 1006, 1004, 1002]
        slope = fog._barometric_slope(pressures)

        assert slope == pytest.approx(-2.0, rel=1e-9)

    def test_flat_pressure_gives_zero_slope(self):
        fog = WeatherFog()
        slope = fog._barometric_slope([1013, 1013, 1013, 1013])

        assert slope == pytest.approx(0.0, abs=1e-9)


class TestStormRiskScore:
    def test_weighted_score_matches_hand_computation(self):
        # slope -2.0 -> pressure_drop=100*0.40=40; speed 20 -> wind=80*0.25=20;
        # rainfall 20 -> rain=50*0.25=12.5; gust stddev 0 -> gust=0*0.10=0;
        # uv 8.0 (clear-sky reference) -> uv_drop=0*0.05=0; total=72.5
        score = WeatherFog._storm_risk_score(
            slope=-2.0, mean_speed=20.0, latest_rainfall=20.0, gust_stddev=0.0, latest_uv_index=8.0
        )
        assert score == pytest.approx(72.5, rel=1e-9)

    def test_low_risk_inputs_give_low_score(self):
        # pressure_drop=10*.4=4, wind=12*.25=3, rain=0, gust=5*.1=0.5,
        # uv 6.0 -> uv_drop=25*.05=1.25 -> total 8.75
        score = WeatherFog._storm_risk_score(
            slope=-0.2, mean_speed=3.0, latest_rainfall=0.0, gust_stddev=0.5, latest_uv_index=6.0
        )
        assert score == pytest.approx(8.75, rel=1e-9)

    def test_score_clamped_to_100(self):
        score = WeatherFog._storm_risk_score(
            slope=-10.0, mean_speed=100.0, latest_rainfall=200.0, gust_stddev=100.0, latest_uv_index=0.0
        )
        assert score == 100.0

    def test_uv_drop_below_clear_sky_reference_raises_score(self):
        # isolates the uv component: everything else held at its zero-signal value
        low_uv_score = WeatherFog._storm_risk_score(
            slope=0.0, mean_speed=0.0, latest_rainfall=0.0, gust_stddev=0.0, latest_uv_index=0.0
        )
        clear_sky_score = WeatherFog._storm_risk_score(
            slope=0.0, mean_speed=0.0, latest_rainfall=0.0, gust_stddev=0.0, latest_uv_index=8.0
        )
        assert low_uv_score == pytest.approx(5.0, rel=1e-9)
        assert clear_sky_score == pytest.approx(0.0, abs=1e-9)

    def test_uv_at_or_above_clear_sky_reference_contributes_nothing(self):
        # a bright, cloudless UV reading (even above the reference) must not itself add signal
        score = WeatherFog._storm_risk_score(
            slope=0.0, mean_speed=0.0, latest_rainfall=0.0, gust_stddev=0.0, latest_uv_index=11.0
        )
        assert score == pytest.approx(0.0, abs=1e-9)


class TestStormWatchTransition:
    def test_dispatches_only_on_crossing_into_high_risk(self):
        fog = WeatherFog()
        station = 'station-arboretum'

        # low-risk baseline for enough samples to fill both windows, no dispatch expected
        low_events = feed_wind_pressure(fog, station, speed=3.0, direction=180.0, pressure=1013.2, count=5)
        assert low_events == []

        # nudge pressure down gently across a few more samples, still under threshold
        for p in [1013.0, 1012.8]:
            events = fog.on_reading(make_reading(station, 'barometric-pressure', p))
        assert events == []

        # now drive a steep pressure drop plus strong wind plus rain to cross >=70
        events = []
        for p in [1010.0, 1006.0, 1002.0, 998.0, 994.0]:
            events += fog.on_reading(make_reading(station, 'wind-speed', 20.0))
            events += fog.on_reading(make_reading(station, 'wind-direction', 90.0))
            events += fog.on_reading(make_reading(station, 'barometric-pressure', p))
            events += fog.on_reading(make_reading(station, 'rainfall', 20.0))

        storm_events = [e for e in events if e.get('type') == 'weather_event']
        assert len(storm_events) == 1
        event = storm_events[0]
        assert event['station_id'] == station
        assert event['storm_risk_score'] >= 70
        assert set(event.keys()) == {
            'type', 'station_id', 'storm_risk_score', 'mean_wind_speed',
            'mean_wind_direction', 'barometric_slope', 'uv_index', 'timestamp',
        }

    def test_does_not_redispatch_while_score_stays_high(self):
        fog = WeatherFog()
        station = 'station-quad'

        for p in [1013.0, 1010.0, 1006.0, 1002.0, 998.0, 994.0]:
            fog.on_reading(make_reading(station, 'wind-speed', 20.0))
            fog.on_reading(make_reading(station, 'wind-direction', 90.0))
            fog.on_reading(make_reading(station, 'barometric-pressure', p))
            fog.on_reading(make_reading(station, 'rainfall', 20.0))

        # first tick sequence above should have already crossed and dispatched once;
        # further ticks holding pressure steady at the low value must not redispatch
        events = []
        for _ in range(5):
            events += fog.on_reading(make_reading(station, 'wind-speed', 20.0))
            events += fog.on_reading(make_reading(station, 'wind-direction', 90.0))
            events += fog.on_reading(make_reading(station, 'barometric-pressure', 994.0))
            events += fog.on_reading(make_reading(station, 'rainfall', 20.0))

        assert events == []

    def test_redispatches_after_dropping_below_and_crossing_again(self):
        fog = WeatherFog()
        station = 'station-quad'

        # cross above 70 once
        first_events = []
        for p in [1013.0, 1010.0, 1006.0, 1002.0, 998.0, 994.0]:
            first_events += fog.on_reading(make_reading(station, 'wind-speed', 20.0))
            first_events += fog.on_reading(make_reading(station, 'wind-direction', 90.0))
            first_events += fog.on_reading(make_reading(station, 'barometric-pressure', p))
            first_events += fog.on_reading(make_reading(station, 'rainfall', 20.0))
        assert len([e for e in first_events if e.get('type') == 'weather_event']) == 1

        # drop back to calm, stable conditions to clear the flag
        for _ in range(10):
            fog.on_reading(make_reading(station, 'wind-speed', 2.0))
            fog.on_reading(make_reading(station, 'wind-direction', 90.0))
            fog.on_reading(make_reading(station, 'barometric-pressure', 1013.0))
            fog.on_reading(make_reading(station, 'rainfall', 0.0))

        # storm builds again
        second_events = []
        for p in [1010.0, 1006.0, 1002.0, 998.0, 994.0]:
            second_events += fog.on_reading(make_reading(station, 'wind-speed', 20.0))
            second_events += fog.on_reading(make_reading(station, 'wind-direction', 90.0))
            second_events += fog.on_reading(make_reading(station, 'barometric-pressure', p))
            second_events += fog.on_reading(make_reading(station, 'rainfall', 20.0))

        assert len([e for e in second_events if e.get('type') == 'weather_event']) == 1


class TestUvIndexTracking:
    def test_uv_index_reading_is_stored_per_station(self):
        fog = WeatherFog()
        fog.on_reading(make_reading('station-quad', 'uv-index', 9.5))

        assert fog._latest_uv_index['station-quad'] == 9.5

    def test_missing_uv_reading_defaults_to_clear_sky_in_the_dispatched_event(self):
        fog = WeatherFog()
        station = 'station-arboretum'

        # no uv-index reading fed in at all; storm still builds from the other metrics
        events = []
        for p in [1013.0, 1010.0, 1006.0, 1002.0, 998.0, 994.0]:
            events += fog.on_reading(make_reading(station, 'wind-speed', 20.0))
            events += fog.on_reading(make_reading(station, 'wind-direction', 90.0))
            events += fog.on_reading(make_reading(station, 'barometric-pressure', p))
            events += fog.on_reading(make_reading(station, 'rainfall', 20.0))

        storm_events = [e for e in events if e.get('type') == 'weather_event']
        assert len(storm_events) == 1
        assert storm_events[0]['uv_index'] == pytest.approx(8.0)

    def test_low_uv_reading_is_carried_into_the_dispatched_event(self):
        fog = WeatherFog()
        station = 'station-quad'

        fog.on_reading(make_reading(station, 'uv-index', 1.0))

        events = []
        for p in [1013.0, 1010.0, 1006.0, 1002.0, 998.0, 994.0]:
            events += fog.on_reading(make_reading(station, 'wind-speed', 20.0))
            events += fog.on_reading(make_reading(station, 'wind-direction', 90.0))
            events += fog.on_reading(make_reading(station, 'barometric-pressure', p))
            events += fog.on_reading(make_reading(station, 'rainfall', 20.0))

        storm_events = [e for e in events if e.get('type') == 'weather_event']
        assert len(storm_events) == 1
        assert storm_events[0]['uv_index'] == pytest.approx(1.0)
