import pytest

from fog_sea_state import SeaStateFog

VESSEL_ID = 'vessel-02'


def _attitude_reading(roll_deg, pitch_deg=0.0, timestamp='2026-07-01T00:00:00Z'):
    return {
        'vesselId': VESSEL_ID,
        'metric': 'nav-attitude',
        'value': {'pitchDeg': pitch_deg, 'rollDeg': roll_deg},
        'unit': 'deg',
        'timestamp': timestamp,
    }


def _wind_reading(speed_kn, timestamp='2026-07-01T00:00:00Z'):
    return {
        'vesselId': VESSEL_ID,
        'metric': 'weather-wind-speed',
        'value': speed_kn,
        'unit': 'kn',
        'timestamp': timestamp,
    }


def test_no_dispatch_before_two_roll_samples():
    fog = SeaStateFog()
    events = fog.on_reading(_attitude_reading(5.0))
    assert events == []


def test_roll_amplitude_and_period_match_hand_computed_reference():
    fog = SeaStateFog()
    rolls = [2, -3, 4]  # window so far: amplitude=7, mean=1.0, signs=[+,-,+], zero_crossings=2, period=3.0

    events = []
    for r in rolls:
        events = fog.on_reading(_attitude_reading(r))

    # the 3rd reading is a class change from None (first recompute), always dispatch-worthy
    assert events[0]['rollAmplitudeDeg'] == pytest.approx(7.0)
    assert events[0]['rollPeriodEstimate'] == pytest.approx(3.0)


@pytest.mark.parametrize('score_roll,score_wind,expected_class', [
    (0.0, 0.0, 'CALM'),
    (5.0, 10.0, 'LIGHT'),   # amplitude*0.6 + wind*0.4 = 3 + 4 = 7 -> LIGHT
    (10.0, 30.0, 'MODERATE'),  # 6 + 12 = 18 -> MODERATE
    (20.0, 50.0, 'ROUGH'),  # 12 + 20 = 32 -> ROUGH
    (40.0, 70.0, 'SEVERE'),  # 24 + 28 = 52 -> SEVERE
])
def test_classification_boundary_table(score_roll, score_wind, expected_class):
    fog = SeaStateFog()
    fog.on_reading(_wind_reading(score_wind))
    fog.on_reading(_attitude_reading(0.0))
    events = fog.on_reading(_attitude_reading(score_roll))

    assert events[0]['seaStateClass'] == expected_class


def test_class_boundaries_are_exact():
    # amplitude alone (wind=0) drives score = amplitude * 0.6
    cases = [
        (0.0, 8.0, 'CALM'),      # score 4.8 < 5
        (8.34, 8.0, 'LIGHT'),    # score ~5.004 >= 5
        (25.0, 8.0, 'LIGHT'),    # score 15 exactly falls into MODERATE boundary check below
    ]
    for amplitude, low, expected in cases[:2]:
        fog = SeaStateFog()
        fog.on_reading(_attitude_reading(0.0))
        events = fog.on_reading(_attitude_reading(amplitude))
        assert events[0]['seaStateClass'] == expected

    # score exactly 15 -> MODERATE (15 <= score < 30)
    fog = SeaStateFog()
    fog.on_reading(_attitude_reading(0.0))
    events = fog.on_reading(_attitude_reading(25.0))  # 25*0.6 = 15.0
    assert events[0]['seaStateClass'] == 'MODERATE'


def test_adaptive_cadence_dispatches_every_recomputation_while_unstable():
    fog = SeaStateFog()
    fog.on_reading(_attitude_reading(0.0))

    dispatched = []
    for roll in [1.0, 1.0, 1.0]:
        events = fog.on_reading(_attitude_reading(roll))
        dispatched.append(len(events) > 0)

    assert dispatched == [True, True, True]


def test_adaptive_cadence_widens_to_every_third_once_stable():
    fog = SeaStateFog()
    fog.on_reading(_attitude_reading(0.0))
    fog.on_reading(_attitude_reading(0.0))  # amplitude 0 -> CALM, dispatched (change from None)

    dispatched = []
    for _ in range(8):
        events = fog.on_reading(_attitude_reading(0.0))  # stays CALM every time
        dispatched.append(len(events) > 0)

    # after streak reaches 3 (3 consecutive same-class recomputations), cadence widens to every 3rd
    assert dispatched == [True, True, False, False, True, False, False, True]


def test_class_change_resets_streak_and_dispatches_immediately():
    fog = SeaStateFog()
    fog.on_reading(_attitude_reading(0.0))
    for _ in range(6):
        fog.on_reading(_attitude_reading(0.0))  # settle into widened cadence on CALM

    events = fog.on_reading(_attitude_reading(100.0))  # sharp jump -> SEVERE, must dispatch immediately
    assert len(events) == 1
    assert events[0]['seaStateClass'] == 'SEVERE'


def test_wind_speed_reading_triggers_recompute_with_latest_value():
    fog = SeaStateFog()
    fog.on_reading(_attitude_reading(0.0))
    fog.on_reading(_attitude_reading(0.0))

    events = fog.on_reading(_wind_reading(20.0))
    assert events[0]['meanWindSpeedKn'] == 20.0
