"""Per-metric value generators. Each returns a plausible next reading given the previous one,
using bounded random walks so downstream fog nodes see realistic drift rather than pure noise."""
import random

ENGINE_RPM_MIN, ENGINE_RPM_MAX = 0, 4500
COOLANT_TEMP_MIN, COOLANT_TEMP_MAX = 40, 110
OIL_PRESSURE_MIN, OIL_PRESSURE_MAX = 0, 700
FUEL_FLOW_MIN, FUEL_FLOW_MAX = 0, 60
VIBRATION_MIN, VIBRATION_MAX = -4, 4
BILGE_MIN, BILGE_MAX = 0, 500
LAT_MIN, LAT_MAX = 53.34, 53.36
LON_MIN, LON_MAX = -6.28, -6.24
PITCH_MIN, PITCH_MAX = -45, 45
ROLL_MIN, ROLL_MAX = -60, 60
WIND_MIN, WIND_MAX = 0, 70
HEADING_MIN, HEADING_MAX = 0, 359


def _clamp(value, lo, hi):
    return max(lo, min(hi, value))


def next_engine_rpm(previous=None):
    if previous is None:
        return round(random.uniform(600, 1200), 1)
    step = random.uniform(-150, 150)
    return round(_clamp(previous + step, ENGINE_RPM_MIN, ENGINE_RPM_MAX), 1)


def next_engine_coolant_temp(previous=None):
    if previous is None:
        return round(random.uniform(60, 85), 2)
    step = random.uniform(-1.5, 1.5)
    return round(_clamp(previous + step, COOLANT_TEMP_MIN, COOLANT_TEMP_MAX), 2)


def next_engine_oil_pressure(previous=None):
    if previous is None:
        return round(random.uniform(250, 450), 2)
    step = random.uniform(-20, 20)
    return round(_clamp(previous + step, OIL_PRESSURE_MIN, OIL_PRESSURE_MAX), 2)


def next_engine_fuel_flow(previous=None):
    if previous is None:
        return round(random.uniform(5, 25), 2)
    step = random.uniform(-3, 3)
    return round(_clamp(previous + step, FUEL_FLOW_MIN, FUEL_FLOW_MAX), 2)


def next_engine_vibration_raw(previous=None):
    # mostly small noise around 0, with an occasional burst so bearing-wear detection has signal
    if random.random() < 0.05:
        burst = random.uniform(2.0, VIBRATION_MAX)
        return round(burst * random.choice([-1, 1]), 3)
    return round(_clamp(random.gauss(0, 0.4), VIBRATION_MIN, VIBRATION_MAX), 3)


def next_hull_bilge_level(previous=None, rising_burst=False):
    # rising_burst simulates a scripted fast-rise event to exercise the alarm path
    if previous is None:
        return round(random.uniform(10, 40), 1)
    if rising_burst:
        step = random.uniform(15, 30)
    else:
        step = random.uniform(-5, 4)
    return round(_clamp(previous + step, BILGE_MIN, BILGE_MAX), 1)


def next_nav_gps(previous=None, timestamp=None):
    if previous is None:
        return {
            "lat": round(random.uniform(LAT_MIN, LAT_MAX), 6),
            "lon": round(random.uniform(LON_MIN, LON_MAX), 6),
        }
    lat_step = random.uniform(-0.0006, 0.0006)
    lon_step = random.uniform(-0.0006, 0.0006)
    lat = _clamp(previous["lat"] + lat_step, LAT_MIN, LAT_MAX)
    lon = _clamp(previous["lon"] + lon_step, LON_MIN, LON_MAX)
    return {"lat": round(lat, 6), "lon": round(lon, 6)}


def next_nav_attitude(previous=None):
    if previous is None:
        return {
            "pitchDeg": round(random.uniform(-5, 5), 2),
            "rollDeg": round(random.uniform(-8, 8), 2),
        }
    pitch = _clamp(previous["pitchDeg"] + random.uniform(-3, 3), PITCH_MIN, PITCH_MAX)
    roll = _clamp(previous["rollDeg"] + random.uniform(-5, 5), ROLL_MIN, ROLL_MAX)
    return {"pitchDeg": round(pitch, 2), "rollDeg": round(roll, 2)}


def next_weather_wind_speed(previous=None):
    if previous is None:
        return round(random.uniform(2, 15), 2)
    step = random.uniform(-4, 4)
    return round(_clamp(previous + step, WIND_MIN, WIND_MAX), 2)


def next_nav_heading(previous=None):
    if previous is None:
        return round(random.uniform(HEADING_MIN, HEADING_MAX), 1)
    step = random.uniform(-10, 10)
    heading = (previous + step) % 360
    return round(heading, 1)
