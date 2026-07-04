"""Each generator must stay within its contract-specified range across many
iterations, and wind-direction must wrap at 0/360 rather than clamp."""
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

import generators as gen

ITERATIONS = 2000


def _walk_stays_in_bounds(next_fn, lo, hi):
    value = None
    for _ in range(ITERATIONS):
        value = next_fn(value)
        assert lo <= value <= hi, f"{value} out of bounds [{lo}, {hi}]"


def test_air_temperature_bounds():
    _walk_stays_in_bounds(gen.next_air_temperature, gen.AIR_TEMPERATURE_MIN, gen.AIR_TEMPERATURE_MAX)


def test_soil_moisture_bounds():
    _walk_stays_in_bounds(gen.next_soil_moisture, gen.SOIL_MOISTURE_MIN, gen.SOIL_MOISTURE_MAX)


def test_rainfall_bounds():
    _walk_stays_in_bounds(gen.next_rainfall, gen.RAINFALL_MIN, gen.RAINFALL_MAX)


def test_wind_speed_bounds():
    _walk_stays_in_bounds(gen.next_wind_speed, gen.WIND_SPEED_MIN, gen.WIND_SPEED_MAX)


def test_uv_index_bounds():
    _walk_stays_in_bounds(gen.next_uv_index, gen.UV_INDEX_MIN, gen.UV_INDEX_MAX)


def test_barometric_pressure_bounds():
    _walk_stays_in_bounds(gen.next_barometric_pressure, gen.BAROMETRIC_PRESSURE_MIN, gen.BAROMETRIC_PRESSURE_MAX)


def test_pm2_5_bounds():
    _walk_stays_in_bounds(gen.next_pm2_5, gen.PM2_5_MIN, gen.PM2_5_MAX)


def test_ambient_noise_bounds():
    _walk_stays_in_bounds(gen.next_ambient_noise, gen.AMBIENT_NOISE_MIN, gen.AMBIENT_NOISE_MAX)


def test_leaf_wetness_bounds():
    _walk_stays_in_bounds(gen.next_leaf_wetness, gen.LEAF_WETNESS_MIN, gen.LEAF_WETNESS_MAX)


def test_wind_direction_bounds():
    value = None
    for _ in range(ITERATIONS):
        value = gen.next_wind_direction(value)
        assert 0.0 <= value < 360.0


def test_wind_direction_wraps_forward_past_360_instead_of_clamping():
    # starting near the top of the range with a forced positive step must
    # wrap around to a small value near 0, not clamp at 359.999...
    import random

    random.seed(42)
    value = 358.0
    wrapped_low = False
    for _ in range(500):
        value = gen.next_wind_direction(value)
        assert 0.0 <= value < 360.0
        if value < 10.0:
            wrapped_low = True
            break
    assert wrapped_low, "expected direction to wrap through 0 rather than clamp near 360"


def test_wind_direction_wraps_backward_past_zero_instead_of_clamping():
    import random

    random.seed(7)
    value = 1.0
    wrapped_high = False
    for _ in range(500):
        value = gen.next_wind_direction(value)
        assert 0.0 <= value < 360.0
        if value > 350.0:
            wrapped_high = True
            break
    assert wrapped_high, "expected direction to wrap through 360 rather than clamp near 0"


def test_generators_registry_covers_all_ten_metrics():
    expected = {
        "air-temperature", "soil-moisture", "rainfall", "wind-speed", "wind-direction",
        "uv-index", "barometric-pressure", "pm2-5", "ambient-noise", "leaf-wetness",
    }
    assert set(gen.GENERATORS.keys()) == expected
