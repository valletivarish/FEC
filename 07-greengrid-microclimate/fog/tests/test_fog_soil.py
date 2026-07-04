from fog_soil import SoilFog


def make_reading(station_id, metric, value, timestamp='2026-01-01T00:00:00Z'):
    return {
        'stationId': station_id,
        'metric': metric,
        'value': value,
        'unit': '',
        'timestamp': timestamp,
    }


class TestIrrigationNeed:
    def test_dry_soil_and_no_rain_triggers_irrigation_need(self):
        fog = SoilFog()
        station = 'station-quad'

        fog.on_reading(make_reading(station, 'rainfall', 0.0))
        events = fog.on_reading(make_reading(station, 'soil-moisture', 15.0))

        risks = [e['risk'] for e in events]
        assert 'irrigation_need' in risks

    def test_moist_soil_does_not_trigger_irrigation_need(self):
        fog = SoilFog()
        station = 'station-quad'

        fog.on_reading(make_reading(station, 'rainfall', 0.0))
        events = fog.on_reading(make_reading(station, 'soil-moisture', 45.0))

        assert events == []

    def test_dry_soil_but_raining_does_not_trigger_irrigation_need(self):
        fog = SoilFog()
        station = 'station-quad'

        fog.on_reading(make_reading(station, 'rainfall', 5.0))
        events = fog.on_reading(make_reading(station, 'soil-moisture', 10.0))

        assert events == []

    def test_only_dispatches_once_on_rising_edge(self):
        fog = SoilFog()
        station = 'station-quad'

        fog.on_reading(make_reading(station, 'rainfall', 0.0))
        first = fog.on_reading(make_reading(station, 'soil-moisture', 10.0))
        second = fog.on_reading(make_reading(station, 'soil-moisture', 8.0))

        assert len([e for e in first if e['risk'] == 'irrigation_need']) == 1
        assert len([e for e in second if e['risk'] == 'irrigation_need']) == 0


class TestFrostRisk:
    def test_watch_severity_for_temp_between_zero_and_two(self):
        fog = SoilFog()
        station = 'station-north-lawn'

        fog.on_reading(make_reading(station, 'leaf-wetness', 5.0))
        events = fog.on_reading(make_reading(station, 'air-temperature', 1.5))

        frost_events = [e for e in events if e['risk'] == 'frost_risk']
        assert len(frost_events) == 1
        assert frost_events[0]['severity'] == 'watch'

    def test_warning_severity_below_zero(self):
        fog = SoilFog()
        station = 'station-north-lawn'

        fog.on_reading(make_reading(station, 'leaf-wetness', 5.0))
        events = fog.on_reading(make_reading(station, 'air-temperature', -1.0))

        frost_events = [e for e in events if e['risk'] == 'frost_risk']
        assert len(frost_events) == 1
        assert frost_events[0]['severity'] == 'warning'

    def test_no_frost_risk_when_leaf_wetness_below_threshold(self):
        fog = SoilFog()
        station = 'station-north-lawn'

        fog.on_reading(make_reading(station, 'leaf-wetness', 2.0))
        events = fog.on_reading(make_reading(station, 'air-temperature', -1.0))

        assert [e for e in events if e['risk'] == 'frost_risk'] == []

    def test_no_frost_risk_when_temp_above_watch_ceiling(self):
        fog = SoilFog()
        station = 'station-north-lawn'

        fog.on_reading(make_reading(station, 'leaf-wetness', 5.0))
        events = fog.on_reading(make_reading(station, 'air-temperature', 5.0))

        assert [e for e in events if e['risk'] == 'frost_risk'] == []


class TestDiseaseRisk:
    def test_requires_three_consecutive_high_wetness_readings(self):
        fog = SoilFog()
        station = 'station-arboretum'

        fog.on_reading(make_reading(station, 'air-temperature', 20.0))
        first = fog.on_reading(make_reading(station, 'leaf-wetness', 9.0))
        second = fog.on_reading(make_reading(station, 'leaf-wetness', 9.0))

        assert [e for e in first if e['risk'] == 'disease_risk'] == []
        assert [e for e in second if e['risk'] == 'disease_risk'] == []

        third = fog.on_reading(make_reading(station, 'leaf-wetness', 9.0))
        assert len([e for e in third if e['risk'] == 'disease_risk']) == 1

    def test_streak_resets_when_reading_drops_below_threshold(self):
        fog = SoilFog()
        station = 'station-arboretum'

        fog.on_reading(make_reading(station, 'air-temperature', 20.0))
        fog.on_reading(make_reading(station, 'leaf-wetness', 9.0))
        fog.on_reading(make_reading(station, 'leaf-wetness', 9.0))
        fog.on_reading(make_reading(station, 'leaf-wetness', 3.0))  # breaks the streak
        third = fog.on_reading(make_reading(station, 'leaf-wetness', 9.0))

        assert [e for e in third if e['risk'] == 'disease_risk'] == []

    def test_requires_temperature_in_fungal_growth_band(self):
        fog = SoilFog()
        station = 'station-arboretum'

        fog.on_reading(make_reading(station, 'air-temperature', 30.0))  # outside 15-27 band
        fog.on_reading(make_reading(station, 'leaf-wetness', 9.0))
        fog.on_reading(make_reading(station, 'leaf-wetness', 9.0))
        events = fog.on_reading(make_reading(station, 'leaf-wetness', 9.0))

        assert [e for e in events if e['risk'] == 'disease_risk'] == []

    def test_boundary_temperatures_are_inclusive(self):
        fog = SoilFog()
        station = 'station-arboretum'

        fog.on_reading(make_reading(station, 'air-temperature', 27.0))
        fog.on_reading(make_reading(station, 'leaf-wetness', 8.0))
        fog.on_reading(make_reading(station, 'leaf-wetness', 8.0))
        events = fog.on_reading(make_reading(station, 'leaf-wetness', 8.0))

        assert len([e for e in events if e['risk'] == 'disease_risk']) == 1


class TestMultipleSimultaneousRisks:
    def test_frost_and_irrigation_can_both_be_active_at_the_same_time(self):
        # irrigation depends on {soil-moisture, rainfall} and frost on {air-temperature,
        # leaf-wetness} - disjoint metric pairs, so each transitions on its own reading, but
        # both flags must be independently trackable as simultaneously active per station
        fog = SoilFog()
        station = 'station-quad'

        fog.on_reading(make_reading(station, 'soil-moisture', 12.0))
        irrigation_events = fog.on_reading(make_reading(station, 'rainfall', 0.0))
        fog.on_reading(make_reading(station, 'leaf-wetness', 6.0))
        frost_events = fog.on_reading(make_reading(station, 'air-temperature', -0.5))

        assert [e['risk'] for e in irrigation_events] == ['irrigation_need']
        assert [e['risk'] for e in frost_events] == ['frost_risk']
        assert fog._active_flags[station]['irrigation_need'] is True
        assert fog._active_flags[station]['frost_risk'] is True

    def test_evaluate_can_emit_multiple_events_from_a_single_snapshot_check(self):
        # every risk rule is re-checked against the full snapshot each call, so a snapshot
        # satisfying two risks at once must return both, not just the first match
        fog = SoilFog()
        station = 'station-north-lawn'
        fog._latest[station] = {
            'soil-moisture': 5.0,
            'rainfall': 0.0,
            'air-temperature': -1.0,
            'leaf-wetness': 5.0,
        }

        events = fog._evaluate(station, '2026-01-01T00:00:00Z')

        risks = {e['risk'] for e in events}
        assert risks == {'irrigation_need', 'frost_risk'}
        assert len(events) == 2

    def test_returns_a_list_not_a_single_verdict(self):
        fog = SoilFog()
        station = 'station-quad'

        events = fog.on_reading(make_reading(station, 'rainfall', 0.0))
        assert isinstance(events, list)


class TestEventShape:
    def test_soil_event_has_expected_keys(self):
        fog = SoilFog()
        station = 'station-quad'

        fog.on_reading(make_reading(station, 'rainfall', 0.0))
        events = fog.on_reading(make_reading(station, 'soil-moisture', 5.0))

        assert events[0]['type'] == 'soil_event'
        assert set(events[0].keys()) == {'type', 'station_id', 'risk', 'severity', 'timestamp'}
        assert events[0]['severity'] is None

    def test_unrelated_metric_is_ignored(self):
        fog = SoilFog()
        events = fog.on_reading(make_reading('station-quad', 'uv-index', 5.0))
        assert events == []
