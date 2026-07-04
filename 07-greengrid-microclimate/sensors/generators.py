"""Per-metric bounded random-walk generators. Each takes the previous value
(or None on first call) and returns a plausible next value within the
metric's documented range from the GreenGrid contract.
"""
import random

# step sizes chosen so a walk can traverse its range in tens of samples,
# not cross it in one tick (keeps series looking physically continuous).

AIR_TEMPERATURE_MIN, AIR_TEMPERATURE_MAX = -10.0, 45.0
SOIL_MOISTURE_MIN, SOIL_MOISTURE_MAX = 0.0, 60.0
RAINFALL_MIN, RAINFALL_MAX = 0.0, 100.0
WIND_SPEED_MIN, WIND_SPEED_MAX = 0.0, 40.0
UV_INDEX_MIN, UV_INDEX_MAX = 0.0, 12.0
BAROMETRIC_PRESSURE_MIN, BAROMETRIC_PRESSURE_MAX = 950.0, 1050.0
PM2_5_MIN, PM2_5_MAX = 0.0, 500.0
AMBIENT_NOISE_MIN, AMBIENT_NOISE_MAX = 30.0, 100.0
LEAF_WETNESS_MIN, LEAF_WETNESS_MAX = 0.0, 15.0


def _walk(previous, default, step, lo, hi):
    """Clamped random walk: reflects at the bounds rather than sticking to them."""
    base = default if previous is None else previous
    value = base + random.uniform(-step, step)
    return max(lo, min(hi, value))


def next_air_temperature(previous=None):
    return _walk(previous, 15.0, 1.5, AIR_TEMPERATURE_MIN, AIR_TEMPERATURE_MAX)


def next_soil_moisture(previous=None):
    return _walk(previous, 30.0, 2.0, SOIL_MOISTURE_MIN, SOIL_MOISTURE_MAX)


def next_rainfall(previous=None):
    # rainfall is bursty rather than a smooth walk: mostly dry, occasional showers.
    if previous is None or previous == 0.0:
        return round(random.uniform(0.0, 3.0), 2) if random.random() < 0.15 else 0.0
    if random.random() < 0.3:
        return 0.0
    return _walk(previous, previous, 5.0, RAINFALL_MIN, RAINFALL_MAX)


def next_wind_speed(previous=None):
    return _walk(previous, 5.0, 2.0, WIND_SPEED_MIN, WIND_SPEED_MAX)


def next_wind_direction(previous=None):
    """Degrees wrap at the 0/360 boundary rather than clamp, so a walk near
    0 can continue smoothly into the 350s (and vice versa)."""
    base = 180.0 if previous is None else previous
    step = random.uniform(-15.0, 15.0)
    return (base + step) % 360.0


def next_uv_index(previous=None):
    return _walk(previous, 3.0, 0.8, UV_INDEX_MIN, UV_INDEX_MAX)


def next_barometric_pressure(previous=None):
    return _walk(previous, 1013.0, 1.0, BAROMETRIC_PRESSURE_MIN, BAROMETRIC_PRESSURE_MAX)


def next_pm2_5(previous=None):
    return _walk(previous, 12.0, 5.0, PM2_5_MIN, PM2_5_MAX)


def next_ambient_noise(previous=None):
    return _walk(previous, 45.0, 3.0, AMBIENT_NOISE_MIN, AMBIENT_NOISE_MAX)


def next_leaf_wetness(previous=None):
    return _walk(previous, 1.0, 1.0, LEAF_WETNESS_MIN, LEAF_WETNESS_MAX)


# metric name (as used on the wire) -> (generator fn, unit)
GENERATORS = {
    "air-temperature": (next_air_temperature, "degC"),
    "soil-moisture": (next_soil_moisture, "%VWC"),
    "rainfall": (next_rainfall, "mm/h"),
    "wind-speed": (next_wind_speed, "m/s"),
    "wind-direction": (next_wind_direction, "degrees"),
    "uv-index": (next_uv_index, "index"),
    "barometric-pressure": (next_barometric_pressure, "hPa"),
    "pm2-5": (next_pm2_5, "ug/m3"),
    "ambient-noise": (next_ambient_noise, "dBA"),
    "leaf-wetness": (next_leaf_wetness, "index"),
}
