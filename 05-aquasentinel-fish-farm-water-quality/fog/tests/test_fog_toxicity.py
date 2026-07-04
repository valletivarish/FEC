import pytest

from fog.fog_toxicity import ToxicityFog

POND = "pond-02"
T0 = "2026-01-01T08:00:00Z"
T1 = "2026-01-01T08:05:00Z"


def ph_reading(value, timestamp=T0, pond=POND):
    return {"pondId": pond, "metric": "ph", "value": value, "unit": "pH", "timestamp": timestamp}


def temp_reading(value, timestamp=T0, pond=POND):
    return {"pondId": pond, "metric": "water-temperature", "value": value, "unit": "degC", "timestamp": timestamp}


def salinity_reading(value, timestamp=T0, pond=POND):
    return {"pondId": pond, "metric": "salinity", "value": value, "unit": "ppt", "timestamp": timestamp}


def ammonia_reading(value, timestamp=T0, pond=POND):
    return {"pondId": pond, "metric": "ammonia-nh3-total", "value": value, "unit": "mg/L", "timestamp": timestamp}


def nitrite_reading(value, timestamp=T0, pond=POND):
    return {"pondId": pond, "metric": "nitrite-no2", "value": value, "unit": "mg/L", "timestamp": timestamp}


def hand_computed_uia(ph, temp, salinity, tan):
    pka = 0.09018 + 2729.92 / (273.2 + temp)
    fraction = 1 / (1 + 10 ** (pka - ph))
    corrected = fraction * (1 - 0.03 * min(salinity, 35) / 35)
    return tan * corrected, pka, corrected


class TestUiaFormula:
    def test_reference_value_safe_case(self):
        # hand-computed: ph=7.0, temp=25.0C, salinity=10ppt, tan=1.0 mg/L
        expected_uia, expected_pka, expected_fraction = hand_computed_uia(7.0, 25.0, 10.0, 1.0)
        assert expected_uia == pytest.approx(0.0056099, abs=1e-6)

        fog = ToxicityFog()
        fog.on_reading(ph_reading(7.0))
        fog.on_reading(temp_reading(25.0))
        fog.on_reading(salinity_reading(10.0))
        events = fog.on_reading(ammonia_reading(1.0))

        assert len(events) == 1
        event = events[0]
        assert event["uia_mg_per_l"] == pytest.approx(expected_uia, rel=1e-9)
        assert event["provenance"]["pka"] == pytest.approx(expected_pka, rel=1e-9)
        assert event["provenance"]["corrected_fraction"] == pytest.approx(expected_fraction, rel=1e-9)
        assert event["severity"] == "safe"

    def test_reference_value_toxic_case(self):
        # hand-computed: ph=8.5, temp=28.0C, salinity=15ppt, tan=2.0 mg/L
        expected_uia, expected_pka, expected_fraction = hand_computed_uia(8.5, 28.0, 15.0, 2.0)
        assert expected_uia == pytest.approx(0.3586589, abs=1e-6)

        fog = ToxicityFog()
        fog.on_reading(ph_reading(8.5))
        fog.on_reading(temp_reading(28.0))
        fog.on_reading(salinity_reading(15.0))
        events = fog.on_reading(ammonia_reading(2.0))

        assert len(events) == 1
        event = events[0]
        assert event["uia_mg_per_l"] == pytest.approx(expected_uia, rel=1e-9)
        assert event["severity"] == "toxic"
        assert event["provenance"]["ph"] == 8.5
        assert event["provenance"]["water_temperature"] == 28.0
        assert event["provenance"]["salinity"] == 15.0


class TestSeverityBands:
    def test_safe_below_0_02(self):
        fog = ToxicityFog()
        fog.on_reading(ph_reading(6.5))
        fog.on_reading(temp_reading(25.0))
        fog.on_reading(salinity_reading(0.0))
        events = fog.on_reading(ammonia_reading(1.0))
        assert events[0]["severity"] == "safe"
        assert events[0]["uia_mg_per_l"] < 0.02

    def test_elevated_band(self):
        fog = ToxicityFog()
        fog.on_reading(ph_reading(7.6))
        fog.on_reading(temp_reading(25.0))
        fog.on_reading(salinity_reading(0.0))
        events = fog.on_reading(ammonia_reading(1.0))
        assert events[0]["severity"] == "elevated"
        assert 0.02 <= events[0]["uia_mg_per_l"] < 0.05

    def test_toxic_band(self):
        fog = ToxicityFog()
        fog.on_reading(ph_reading(8.0))
        fog.on_reading(temp_reading(25.0))
        fog.on_reading(salinity_reading(0.0))
        events = fog.on_reading(ammonia_reading(1.0))
        assert events[0]["severity"] == "toxic"
        assert events[0]["uia_mg_per_l"] >= 0.05

    def test_dispatch_only_on_severity_transition(self):
        fog = ToxicityFog()
        fog.on_reading(ph_reading(6.5))
        fog.on_reading(temp_reading(25.0))
        fog.on_reading(salinity_reading(0.0))
        first = fog.on_reading(ammonia_reading(1.0, timestamp=T0))
        assert len(first) == 1
        # same severity band again -> no re-dispatch
        second = fog.on_reading(ammonia_reading(1.05, timestamp=T1))
        assert second == []

    def test_toxic_always_dispatches_even_without_transition(self):
        fog = ToxicityFog()
        fog.on_reading(ph_reading(8.0))
        fog.on_reading(temp_reading(25.0))
        fog.on_reading(salinity_reading(0.0))
        first = fog.on_reading(ammonia_reading(1.0, timestamp=T0))
        assert first[0]["severity"] == "toxic"
        second = fog.on_reading(ammonia_reading(1.1, timestamp=T1))
        assert len(second) == 1
        assert second[0]["severity"] == "toxic"


class TestNitriteContextField:
    def test_ammonia_triggered_event_carries_latest_nitrite(self):
        fog = ToxicityFog()
        fog.on_reading(ph_reading(7.0))
        fog.on_reading(temp_reading(25.0))
        fog.on_reading(salinity_reading(10.0))
        fog.on_reading(nitrite_reading(0.3))
        events = fog.on_reading(ammonia_reading(1.0))
        assert events[0]["provenance"]["nitrite_no2"] == 0.3

    def test_nitrite_absent_when_never_reported(self):
        fog = ToxicityFog()
        fog.on_reading(ph_reading(7.0))
        fog.on_reading(temp_reading(25.0))
        events = fog.on_reading(ammonia_reading(1.0))
        assert events[0]["provenance"]["nitrite_no2"] is None


class TestBrownBloodRisk:
    def test_nitrite_above_threshold_raises_flag_independently_of_ammonia_state(self):
        fog = ToxicityFog()
        fog.on_reading(ph_reading(6.5))
        fog.on_reading(temp_reading(25.0))
        events = fog.on_reading(nitrite_reading(0.6))
        assert len(events) == 1
        assert events[0]["nitrite_brown_blood_risk"] is True
        assert events[0]["severity"] == "safe"

    def test_nitrite_below_threshold_no_flag(self):
        fog = ToxicityFog()
        events = fog.on_reading(nitrite_reading(0.3))
        assert events == []

    def test_brown_blood_flag_transitions_only(self):
        fog = ToxicityFog()
        first = fog.on_reading(nitrite_reading(0.6, timestamp=T0))
        assert len(first) == 1
        second = fog.on_reading(nitrite_reading(0.7, timestamp=T1))
        assert second == []

    def test_ammonia_toxic_and_nitrite_risk_can_both_be_active(self):
        fog = ToxicityFog()
        fog.on_reading(ph_reading(8.0))
        fog.on_reading(temp_reading(25.0))
        fog.on_reading(salinity_reading(0.0))
        fog.on_reading(nitrite_reading(0.6, timestamp=T0))
        events = fog.on_reading(ammonia_reading(1.0, timestamp=T1))
        assert events[0]["severity"] == "toxic"
        assert events[0]["nitrite_brown_blood_risk"] is True
