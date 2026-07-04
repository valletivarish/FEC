"""Bounds checks for each generator across many random-walk iterations."""
from sensors import generators

ITERATIONS = 2000


def test_engine_rpm_stays_within_bounds():
    value = None
    for _ in range(ITERATIONS):
        value = generators.next_engine_rpm(value)
        assert generators.ENGINE_RPM_MIN <= value <= generators.ENGINE_RPM_MAX


def test_engine_coolant_temp_stays_within_bounds():
    value = None
    for _ in range(ITERATIONS):
        value = generators.next_engine_coolant_temp(value)
        assert generators.COOLANT_TEMP_MIN <= value <= generators.COOLANT_TEMP_MAX


def test_engine_oil_pressure_stays_within_bounds():
    value = None
    for _ in range(ITERATIONS):
        value = generators.next_engine_oil_pressure(value)
        assert generators.OIL_PRESSURE_MIN <= value <= generators.OIL_PRESSURE_MAX


def test_engine_fuel_flow_stays_within_bounds():
    value = None
    for _ in range(ITERATIONS):
        value = generators.next_engine_fuel_flow(value)
        assert generators.FUEL_FLOW_MIN <= value <= generators.FUEL_FLOW_MAX


def test_engine_vibration_raw_stays_within_bounds():
    for _ in range(ITERATIONS):
        value = generators.next_engine_vibration_raw()
        assert generators.VIBRATION_MIN <= value <= generators.VIBRATION_MAX


def test_engine_vibration_raw_occasionally_bursts():
    # confirm the burst path actually fires across enough samples to be exercised by EngineFog
    values = [generators.next_engine_vibration_raw() for _ in range(3000)]
    burst_count = sum(1 for v in values if abs(v) > 1.5)
    assert burst_count > 0


def test_hull_bilge_level_stays_within_bounds():
    value = None
    for _ in range(ITERATIONS):
        value = generators.next_hull_bilge_level(value)
        assert generators.BILGE_MIN <= value <= generators.BILGE_MAX


def test_hull_bilge_level_rising_burst_stays_within_bounds():
    value = 50.0
    for _ in range(ITERATIONS):
        value = generators.next_hull_bilge_level(value, rising_burst=True)
        assert generators.BILGE_MIN <= value <= generators.BILGE_MAX


def test_hull_bilge_level_rising_burst_actually_rises():
    value = 10.0
    for _ in range(20):
        value = generators.next_hull_bilge_level(value, rising_burst=True)
    assert value > 100


def test_nav_gps_stays_within_box():
    value = None
    for _ in range(ITERATIONS):
        value = generators.next_nav_gps(value)
        assert generators.LAT_MIN <= value["lat"] <= generators.LAT_MAX
        assert generators.LON_MIN <= value["lon"] <= generators.LON_MAX


def test_nav_gps_wanders_smoothly_not_teleporting():
    value = generators.next_nav_gps(None)
    for _ in range(200):
        previous = value
        value = generators.next_nav_gps(previous)
        assert abs(value["lat"] - previous["lat"]) < 0.001
        assert abs(value["lon"] - previous["lon"]) < 0.001


def test_nav_attitude_stays_within_bounds():
    value = None
    for _ in range(ITERATIONS):
        value = generators.next_nav_attitude(value)
        assert generators.PITCH_MIN <= value["pitchDeg"] <= generators.PITCH_MAX
        assert generators.ROLL_MIN <= value["rollDeg"] <= generators.ROLL_MAX


def test_weather_wind_speed_stays_within_bounds():
    value = None
    for _ in range(ITERATIONS):
        value = generators.next_weather_wind_speed(value)
        assert generators.WIND_MIN <= value <= generators.WIND_MAX


def test_nav_heading_stays_within_bounds():
    # heading wraps continuously in [0, 360) rather than clamping at a hard 359 like the other metrics
    value = None
    for _ in range(ITERATIONS):
        value = generators.next_nav_heading(value)
        assert generators.HEADING_MIN <= value < 360


def test_nav_heading_wraps_around_360():
    value = 355.0
    for _ in range(50):
        value = generators.next_nav_heading(value)
        assert 0 <= value < 360
